using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace OpenRevuPortable
{
    static class Program
    {
        public static string RuntimeDir;
        public static string DistDir;
        public static int ServerPort;
        private static TcpListener _listener;
        private static volatile bool _running = true;
        private static volatile bool _hasDirtyDocs = false;
        private static readonly object _storageLock = new object();
        public static string ToolChestStoragePath;
        private static string _startupPdfPath = null;
        private static readonly HashSet<string> _allowedNativePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private static Form _mainForm = null;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectory(string lpPathName);

        private static byte[] ReadAllBytesShared(string fullPath)
        {
            using (var fs = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var ms = new MemoryStream())
            {
                fs.CopyTo(ms);
                return ms.ToArray();
            }
        }

        private static bool IsFileReadOnlyOrLocked(string fullPath)
        {
            try
            {
                var attrs = File.GetAttributes(fullPath);
                if ((attrs & FileAttributes.ReadOnly) != 0)
                {
                    return true;
                }
                using (var fs = new FileStream(fullPath, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite))
                {
                    return false;
                }
            }
            catch (IOException)
            {
                return true;
            }
            catch (UnauthorizedAccessException)
            {
                return true;
            }
            catch
            {
                return true;
            }
        }

        private static string EscapeJsonString(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
        }

        [STAThread]
        static void Main(string[] args)
        {
            if (args != null && args.Length > 0 && !string.IsNullOrWhiteSpace(args[0]))
            {
                try
                {
                    string candidate = Path.GetFullPath(args[0]);
                    if (File.Exists(candidate) && string.Equals(Path.GetExtension(candidate), ".pdf", StringComparison.OrdinalIgnoreCase))
                    {
                        _startupPdfPath = candidate;
                        _allowedNativePaths.Add(candidate);
                    }
                }
                catch { }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                // 1. Prepara la cartella runtime locale in %LOCALAPPDATA%\OpenRevu
                string baseAppData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "OpenRevu"
                );
                string exeStem = Path.GetFileNameWithoutExtension(Application.ExecutablePath);
                string runtimeFolder = exeStem.IndexOf("Rev3", StringComparison.OrdinalIgnoreCase) >= 0
                    ? "runtime_v3_0_0"
                    : "runtime_v2_0_0";
                RuntimeDir = Path.Combine(baseAppData, runtimeFolder);
                DistDir = Path.Combine(RuntimeDir, "dist");
                ToolChestStoragePath = Path.Combine(baseAppData, "toolchest_data.json");
                Directory.CreateDirectory(baseAppData);
                Directory.CreateDirectory(RuntimeDir);

                // Estrae le DLL di WebView2 se non presenti
                ExtractResourceIfNeeded("Microsoft.Web.WebView2.Core.dll", Path.Combine(RuntimeDir, "Microsoft.Web.WebView2.Core.dll"));
                ExtractResourceIfNeeded("Microsoft.Web.WebView2.WinForms.dll", Path.Combine(RuntimeDir, "Microsoft.Web.WebView2.WinForms.dll"));
                ExtractResourceIfNeeded("WebView2Loader.dll", Path.Combine(RuntimeDir, "WebView2Loader.dll"));

                // Imposta il percorso nativo per WebView2Loader.dll
                SetDllDirectory(RuntimeDir);

                // Registra il resolver per le DLL managed di WebView2
                AppDomain.CurrentDomain.AssemblyResolve += OnResolveAssembly;

                // Estrae dist.zip (controllando il timestamp dell'eseguibile per aggiornare automaticamente la build)
                string stampFile = Path.Combine(RuntimeDir, "build.stamp");
                string currentStamp = File.GetLastWriteTimeUtc(Application.ExecutablePath).Ticks.ToString();
                if (!Directory.Exists(DistDir) || !File.Exists(stampFile) || File.ReadAllText(stampFile) != currentStamp)
                {
                    if (Directory.Exists(DistDir))
                    {
                        try { Directory.Delete(DistDir, true); } catch { }
                    }
                    Directory.CreateDirectory(DistDir);

                    string zipPath = Path.Combine(RuntimeDir, "dist.zip");
                    ExtractResourceAlways("dist.zip", zipPath);
                    ZipFile.ExtractToDirectory(zipPath, DistDir);
                    try { File.Delete(zipPath); } catch { }
                    File.WriteAllText(stampFile, currentStamp);
                }

                // 2. Avvia il server HTTP locale su loopback (127.0.0.1:0)
                StartLoopbackServer();

                // 3. Avvia la finestra nativa con WebView2
                RunWebViewWindow();
            }
            catch (Exception ex)
            {
                try
                {
                    File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "startup_error.log"), ex.ToString());
                }
                catch { }
                MessageBox.Show(
                    "Errore durante l'avvio di OpenRevu Portable:\n" + ex.Message,
                    "OpenRevu CAD",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
            finally
            {
                _running = false;
                try { if (_listener != null) _listener.Stop(); } catch { }
            }
        }

        private static Assembly OnResolveAssembly(object sender, ResolveEventArgs args)
        {
            string shortName = new AssemblyName(args.Name).Name + ".dll";
            string candidate = Path.Combine(RuntimeDir, shortName);
            if (File.Exists(candidate))
            {
                return Assembly.LoadFrom(candidate);
            }
            return null;
        }

        private static void ExtractResourceIfNeeded(string resourceName, string targetPath)
        {
            if (File.Exists(targetPath) && new FileInfo(targetPath).Length > 0) return;
            ExtractResourceAlways(resourceName, targetPath);
        }

        private static void ExtractResourceAlways(string resourceName, string targetPath)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (s == null)
                    throw new InvalidOperationException("Risorsa incorporata mancante: " + resourceName);
                using (FileStream fs = new FileStream(targetPath, FileMode.Create, FileAccess.Write, FileShare.Read))
                {
                    s.CopyTo(fs);
                }
            }
        }

        private static void StartLoopbackServer()
        {
            int[] preferredPorts = new int[] { 48721, 48722, 48723, 48724, 48725, 0 };
            Exception lastEx = null;
            foreach (int p in preferredPorts)
            {
                try
                {
                    var candidate = new TcpListener(IPAddress.Loopback, p);
                    candidate.Start();
                    _listener = candidate;
                    break;
                }
                catch (Exception ex)
                {
                    lastEx = ex;
                }
            }
            if (_listener == null)
                throw lastEx ?? new InvalidOperationException("Impossibile avviare il server locale.");
            ServerPort = ((IPEndPoint)_listener.LocalEndpoint).Port;

            Thread acceptThread = new Thread(() =>
            {
                while (_running)
                {
                    try
                    {
                        TcpClient client = _listener.AcceptTcpClient();
                        ThreadPool.QueueUserWorkItem(HandleClient, client);
                    }
                    catch
                    {
                        if (!_running) break;
                    }
                }
            });
            acceptThread.IsBackground = true;
            acceptThread.Start();
        }

        private static void HandleClient(object state)
        {
            using (TcpClient client = (TcpClient)state)
            {
                try
                {
                    client.ReceiveTimeout = 5000;
                    client.SendTimeout = 5000;
                    using (NetworkStream stream = client.GetStream())
                    {
                        // Legge gli header HTTP byte per byte fino a \r\n\r\n senza perdere eventuali byte del body
                        var headerBuf = new MemoryStream();
                        int prev3 = 0, prev2 = 0, prev1 = 0, curr;
                        while ((curr = stream.ReadByte()) != -1)
                        {
                            headerBuf.WriteByte((byte)curr);
                            if (prev3 == '\r' && prev2 == '\n' && prev1 == '\r' && curr == '\n') break;
                            if (headerBuf.Length > 65536) return;
                            prev3 = prev2; prev2 = prev1; prev1 = curr;
                        }
                        string headerText = Encoding.ASCII.GetString(headerBuf.ToArray());
                        string[] headerLines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
                        if (headerLines.Length == 0) return;

                        string[] parts = headerLines[0].Split(' ');
                        if (parts.Length < 2) return;

                        string method = parts[0].ToUpperInvariant();
                        string rawUrl = parts[1];
                        int qIdx = rawUrl.IndexOf('?');
                        string urlPath = qIdx >= 0 ? rawUrl.Substring(0, qIdx) : rawUrl;
                        urlPath = Uri.UnescapeDataString(urlPath);

                        int contentLength = 0;
                        string headerFilePath = null;
                        string headerSuggestedPath = null;
                        string headerAuthor = null;
                        foreach (string hLine in headerLines)
                        {
                            if (hLine.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                            {
                                int.TryParse(hLine.Substring(15).Trim(), out contentLength);
                            }
                            else if (hLine.StartsWith("X-File-Path:", StringComparison.OrdinalIgnoreCase))
                            {
                                headerFilePath = Uri.UnescapeDataString(hLine.Substring(12).Trim());
                            }
                            else if (hLine.StartsWith("X-Suggested-Path:", StringComparison.OrdinalIgnoreCase))
                            {
                                headerSuggestedPath = Uri.UnescapeDataString(hLine.Substring(17).Trim());
                            }
                            else if (hLine.StartsWith("X-Author:", StringComparison.OrdinalIgnoreCase))
                            {
                                headerAuthor = Uri.UnescapeDataString(hLine.Substring(9).Trim());
                            }
                        }

                        // API apertura nativa multipla PDF (finestra nativa Windows, zero popup Edge)
                        if (urlPath == "/__api/open-native-multi")
                        {
                            if (_mainForm == null)
                            {
                                byte[] badResp = Encoding.ASCII.GetBytes("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                                stream.Write(badResp, 0, badResp.Length);
                                return;
                            }
                            string[] chosenPaths = null;
                            _mainForm.Invoke(new Action(() =>
                            {
                                using (var dlg = new OpenFileDialog())
                                {
                                    dlg.Title = "Apri PDF Tecnici";
                                    dlg.Filter = "Documenti PDF (*.pdf)|*.pdf";
                                    dlg.Multiselect = true;
                                    if (dlg.ShowDialog(_mainForm) == DialogResult.OK)
                                    {
                                        chosenPaths = dlg.FileNames;
                                    }
                                }
                            }));
                            if (chosenPaths == null || chosenPaths.Length == 0)
                            {
                                byte[] noContent = Encoding.ASCII.GetBytes("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n");
                                stream.Write(noContent, 0, noContent.Length);
                                return;
                            }
                            var items = new List<string>();
                            foreach (string p in chosenPaths)
                            {
                                if (string.IsNullOrEmpty(p) || !File.Exists(p)) continue;
                                string fullP = Path.GetFullPath(p);
                                lock (_storageLock)
                                {
                                    _allowedNativePaths.Add(fullP);
                                }
                                bool isRo = IsFileReadOnlyOrLocked(fullP);
                                items.Add(
                                    "{\"fileName\":\"" + EscapeJsonString(Path.GetFileName(fullP)) +
                                    "\",\"filePath\":\"" + EscapeJsonString(fullP) +
                                    "\",\"readOnly\":" + (isRo ? "true" : "false") + "}"
                                );
                            }
                            string jsonResp = "{\"ok\":true,\"files\":[" + string.Join(",", items) + "]}";
                            byte[] jsonBytes = Encoding.UTF8.GetBytes(jsonResp);
                            string okHdr =
                                "HTTP/1.1 200 OK\r\n" +
                                "Content-Type: application/json; charset=utf-8\r\n" +
                                "Content-Length: " + jsonBytes.Length + "\r\n" +
                                "Access-Control-Allow-Origin: *\r\n" +
                                "Cache-Control: no-store\r\n" +
                                "Connection: close\r\n\r\n";
                            byte[] okHdrBytes = Encoding.ASCII.GetBytes(okHdr);
                            stream.Write(okHdrBytes, 0, okHdrBytes.Length);
                            stream.Write(jsonBytes, 0, jsonBytes.Length);
                            stream.Flush();
                            return;
                        }

                        // API lettura binaria di un file PDF autorizzato (anche se aperto/bloccato da un altro programma)
                        if (urlPath == "/__api/read-native")
                        {
                            if (method == "OPTIONS")
                            {
                                byte[] opt = Encoding.ASCII.GetBytes("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-File-Path\r\nConnection: close\r\n\r\n");
                                stream.Write(opt, 0, opt.Length);
                                return;
                            }
                            if (!string.IsNullOrEmpty(headerFilePath))
                            {
                                string fullTarget = Path.GetFullPath(headerFilePath);
                                bool allowed;
                                lock (_storageLock)
                                {
                                    allowed = _allowedNativePaths.Contains(fullTarget);
                                }
                                if (!allowed || !File.Exists(fullTarget))
                                {
                                    byte[] forbidden = Encoding.ASCII.GetBytes("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                                    stream.Write(forbidden, 0, forbidden.Length);
                                    return;
                                }
                                byte[] pdfBytes = ReadAllBytesShared(fullTarget);
                                bool isRo = IsFileReadOnlyOrLocked(fullTarget);
                                string fileHdr =
                                    "HTTP/1.1 200 OK\r\n" +
                                    "Content-Type: application/pdf\r\n" +
                                    "Content-Length: " + pdfBytes.Length + "\r\n" +
                                    "X-File-Name: " + Uri.EscapeDataString(Path.GetFileName(fullTarget)) + "\r\n" +
                                    "X-File-Path: " + Uri.EscapeDataString(fullTarget) + "\r\n" +
                                    "X-File-ReadOnly: " + (isRo ? "true" : "false") + "\r\n" +
                                    "Access-Control-Allow-Origin: *\r\n" +
                                    "Cache-Control: no-store\r\n" +
                                    "Connection: close\r\n\r\n";
                                byte[] fileHdrBytes = Encoding.ASCII.GetBytes(fileHdr);
                                stream.Write(fileHdrBytes, 0, fileHdrBytes.Length);
                                stream.Write(pdfBytes, 0, pdfBytes.Length);
                                stream.Flush();
                                return;
                            }
                            byte[] badResp = Encoding.ASCII.GetBytes("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                            stream.Write(badResp, 0, badResp.Length);
                            return;
                        }

                        // API apertura nativa PDF (con percorso reale su cartella di rete condivisa per Studio Live)
                        if (urlPath == "/__api/open-native")
                        {
                            if (_mainForm == null)
                            {
                                byte[] badResp = Encoding.ASCII.GetBytes("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                                stream.Write(badResp, 0, badResp.Length);
                                return;
                            }
                            string chosenPath = null;
                            _mainForm.Invoke(new Action(() =>
                            {
                                using (var dlg = new OpenFileDialog())
                                {
                                    dlg.Title = "Apri PDF condiviso (Studio Live)";
                                    dlg.Filter = "Documenti PDF (*.pdf)|*.pdf";
                                    dlg.Multiselect = false;
                                    if (dlg.ShowDialog(_mainForm) == DialogResult.OK)
                                    {
                                        chosenPath = dlg.FileName;
                                    }
                                }
                            }));
                            if (string.IsNullOrEmpty(chosenPath) || !File.Exists(chosenPath))
                            {
                                byte[] noContent = Encoding.ASCII.GetBytes("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n");
                                stream.Write(noContent, 0, noContent.Length);
                                return;
                            }
                            string fullChosen = Path.GetFullPath(chosenPath);
                            lock (_storageLock)
                            {
                                _allowedNativePaths.Add(fullChosen);
                            }
                            byte[] pdfBytes = ReadAllBytesShared(fullChosen);
                            bool isRo = IsFileReadOnlyOrLocked(fullChosen);
                            string fileHdr =
                                "HTTP/1.1 200 OK\r\n" +
                                "Content-Type: application/pdf\r\n" +
                                "Content-Length: " + pdfBytes.Length + "\r\n" +
                                "X-File-Name: " + Uri.EscapeDataString(Path.GetFileName(fullChosen)) + "\r\n" +
                                "X-File-Path: " + Uri.EscapeDataString(fullChosen) + "\r\n" +
                                "X-File-ReadOnly: " + (isRo ? "true" : "false") + "\r\n" +
                                "Access-Control-Allow-Origin: *\r\n" +
                                "Cache-Control: no-store\r\n" +
                                "Connection: close\r\n\r\n";
                            byte[] fileHdrBytes = Encoding.ASCII.GetBytes(fileHdr);
                            stream.Write(fileHdrBytes, 0, fileHdrBytes.Length);
                            stream.Write(pdfBytes, 0, pdfBytes.Length);
                            stream.Flush();
                            return;
                        }

                        // API Studio Live su cartella condivisa: scrive il file JSON dell'utente e legge quelli dei colleghi
                        if (urlPath == "/__api/studio-sync")
                        {
                            if (method == "OPTIONS")
                            {
                                byte[] opt = Encoding.ASCII.GetBytes("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-File-Path, X-Author\r\nConnection: close\r\n\r\n");
                                stream.Write(opt, 0, opt.Length);
                                return;
                            }
                            if (method == "POST" && !string.IsNullOrEmpty(headerFilePath) && !string.IsNullOrEmpty(headerAuthor) && contentLength > 0 && contentLength < 64 * 1024 * 1024)
                            {
                                string fullPdfPath = Path.GetFullPath(headerFilePath);
                                bool allowed;
                                lock (_storageLock)
                                {
                                    allowed = _allowedNativePaths.Contains(fullPdfPath);
                                }
                                if (!allowed)
                                {
                                    byte[] forbidden = Encoding.ASCII.GetBytes("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                                    stream.Write(forbidden, 0, forbidden.Length);
                                    return;
                                }
                                byte[] reqBody = new byte[contentLength];
                                int readTotal = 0;
                                while (readTotal < contentLength)
                                {
                                    int r = stream.Read(reqBody, readTotal, contentLength - readTotal);
                                    if (r <= 0) break;
                                    readTotal += r;
                                }
                                if (readTotal == contentLength)
                                {
                                    string safeAuthor = RegexReplaceInvalidChars(headerAuthor);
                                    string sessionDir = fullPdfPath + ".openrevu-session";
                                    var peerPayloads = new List<string>();
                                    lock (_storageLock)
                                    {
                                        Directory.CreateDirectory(sessionDir);
                                        string myFile = Path.Combine(sessionDir, safeAuthor + ".json");
                                        string tmpFile = myFile + ".tmp";
                                        File.WriteAllBytes(tmpFile, reqBody);
                                        if (File.Exists(myFile)) File.Delete(myFile);
                                        File.Move(tmpFile, myFile);

                                        foreach (string f in Directory.GetFiles(sessionDir, "*.json"))
                                        {
                                            if (string.Equals(Path.GetFullPath(f), Path.GetFullPath(myFile), StringComparison.OrdinalIgnoreCase))
                                                continue;
                                            try
                                            {
                                                string content = File.ReadAllText(f, Encoding.UTF8);
                                                if (!string.IsNullOrWhiteSpace(content))
                                                {
                                                    peerPayloads.Add(content);
                                                }
                                            }
                                            catch { }
                                        }
                                    }
                                    string respJson = "{\"ok\":true,\"peers\":[" + string.Join(",", peerPayloads) + "]}";
                                    byte[] respBytes = Encoding.UTF8.GetBytes(respJson);
                                    string okHdr =
                                        "HTTP/1.1 200 OK\r\n" +
                                        "Content-Type: application/json; charset=utf-8\r\n" +
                                        "Content-Length: " + respBytes.Length + "\r\n" +
                                        "Access-Control-Allow-Origin: *\r\n" +
                                        "Cache-Control: no-store\r\n" +
                                        "Connection: close\r\n\r\n";
                                    byte[] okHdrBytes = Encoding.ASCII.GetBytes(okHdr);
                                    stream.Write(okHdrBytes, 0, okHdrBytes.Length);
                                    stream.Write(respBytes, 0, respBytes.Length);
                                    stream.Flush();
                                    return;
                                }
                            }
                            byte[] badResp = Encoding.ASCII.GetBytes("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                            stream.Write(badResp, 0, badResp.Length);
                            return;
                        }

                        // API avvio diretto file da riga di comando / "Apri con"
                        if (urlPath == "/__api/startup-file")
                        {
                            string pathToSend = null;
                            lock (_storageLock)
                            {
                                if (!string.IsNullOrEmpty(_startupPdfPath) && File.Exists(_startupPdfPath))
                                {
                                    pathToSend = _startupPdfPath;
                                    _startupPdfPath = null;
                                }
                            }
                            if (pathToSend == null)
                            {
                                byte[] noContent = Encoding.ASCII.GetBytes("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n");
                                stream.Write(noContent, 0, noContent.Length);
                                return;
                            }
                            byte[] pdfBytes = ReadAllBytesShared(pathToSend);
                            bool isRo = IsFileReadOnlyOrLocked(pathToSend);
                            string fileHdr =
                                "HTTP/1.1 200 OK\r\n" +
                                "Content-Type: application/pdf\r\n" +
                                "Content-Length: " + pdfBytes.Length + "\r\n" +
                                "X-File-Name: " + Uri.EscapeDataString(Path.GetFileName(pathToSend)) + "\r\n" +
                                "X-File-Path: " + Uri.EscapeDataString(pathToSend) + "\r\n" +
                                "X-File-ReadOnly: " + (isRo ? "true" : "false") + "\r\n" +
                                "Access-Control-Allow-Origin: *\r\n" +
                                "Cache-Control: no-store\r\n" +
                                "Connection: close\r\n\r\n";
                            byte[] fileHdrBytes = Encoding.ASCII.GetBytes(fileHdr);
                            stream.Write(fileHdrBytes, 0, fileHdrBytes.Length);
                            stream.Write(pdfBytes, 0, pdfBytes.Length);
                            stream.Flush();
                            return;
                        }

                        // API sovrascrittura file PDF originale aperto da riga di comando / "Apri con"
                        if (urlPath == "/__api/save-native")
                        {
                            if (method == "OPTIONS")
                            {
                                byte[] opt = Encoding.ASCII.GetBytes("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-File-Path\r\nConnection: close\r\n\r\n");
                                stream.Write(opt, 0, opt.Length);
                                return;
                            }
                            if (method == "POST" && !string.IsNullOrEmpty(headerFilePath) && contentLength > 0 && contentLength < 256 * 1024 * 1024)
                            {
                                string fullTarget = Path.GetFullPath(headerFilePath);
                                bool allowed;
                                lock (_storageLock)
                                {
                                    allowed = _allowedNativePaths.Contains(fullTarget);
                                }
                                if (!allowed)
                                {
                                    byte[] forbidden = Encoding.ASCII.GetBytes("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                                    stream.Write(forbidden, 0, forbidden.Length);
                                    return;
                                }
                                byte[] reqBody = new byte[contentLength];
                                int readTotal = 0;
                                while (readTotal < contentLength)
                                {
                                    int r = stream.Read(reqBody, readTotal, contentLength - readTotal);
                                    if (r <= 0) break;
                                    readTotal += r;
                                }
                                if (readTotal == contentLength)
                                {
                                    try
                                    {
                                        lock (_storageLock)
                                        {
                                            File.WriteAllBytes(fullTarget, reqBody);
                                        }
                                        byte[] okResp = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{\"ok\":true}");
                                        stream.Write(okResp, 0, okResp.Length);
                                        return;
                                    }
                                    catch (Exception ex)
                                    {
                                        if (ex is IOException || ex is UnauthorizedAccessException)
                                        {
                                            byte[] lockedResp = Encoding.ASCII.GetBytes("HTTP/1.1 423 Locked\r\nContent-Type: application/json\r\nContent-Length: 26\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{\"ok\":false,\"locked\":true}");
                                            stream.Write(lockedResp, 0, lockedResp.Length);
                                            return;
                                        }
                                        throw;
                                    }
                                }
                            }
                            byte[] badResp = Encoding.ASCII.GetBytes("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                            stream.Write(badResp, 0, badResp.Length);
                            return;
                        }

                        // API Salva con nome nativo sulla cartella del file originale
                        if (urlPath == "/__api/save-as-native")
                        {
                            if (method == "OPTIONS")
                            {
                                byte[] opt = Encoding.ASCII.GetBytes("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Suggested-Path\r\nConnection: close\r\n\r\n");
                                stream.Write(opt, 0, opt.Length);
                                return;
                            }
                            if (method == "POST" && contentLength > 0 && contentLength < 256 * 1024 * 1024 && _mainForm != null)
                            {
                                byte[] reqBody = new byte[contentLength];
                                int readTotal = 0;
                                while (readTotal < contentLength)
                                {
                                    int r = stream.Read(reqBody, readTotal, contentLength - readTotal);
                                    if (r <= 0) break;
                                    readTotal += r;
                                }
                                if (readTotal == contentLength)
                                {
                                    string chosenPath = null;
                                    _mainForm.Invoke(new Action(() =>
                                    {
                                        using (var dlg = new SaveFileDialog())
                                        {
                                            dlg.Title = "Salva con nome";
                                            dlg.Filter = "Documenti PDF (*.pdf)|*.pdf";
                                            if (!string.IsNullOrEmpty(headerSuggestedPath))
                                            {
                                                string dir = Path.GetDirectoryName(headerSuggestedPath);
                                                if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir))
                                                {
                                                    dlg.InitialDirectory = dir;
                                                }
                                                dlg.FileName = Path.GetFileName(headerSuggestedPath);
                                            }
                                            if (dlg.ShowDialog(_mainForm) == DialogResult.OK)
                                            {
                                                chosenPath = dlg.FileName;
                                            }
                                        }
                                    }));
                                    if (string.IsNullOrEmpty(chosenPath))
                                    {
                                        byte[] cancelled = Encoding.ASCII.GetBytes("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n");
                                        stream.Write(cancelled, 0, cancelled.Length);
                                        return;
                                    }
                                    string fullChosen = Path.GetFullPath(chosenPath);
                                    try
                                    {
                                        lock (_storageLock)
                                        {
                                            File.WriteAllBytes(fullChosen, reqBody);
                                            _allowedNativePaths.Add(fullChosen);
                                        }
                                    }
                                    catch (Exception ex)
                                    {
                                        if (ex is IOException || ex is UnauthorizedAccessException)
                                        {
                                            byte[] lockedResp = Encoding.ASCII.GetBytes("HTTP/1.1 423 Locked\r\nContent-Type: application/json\r\nContent-Length: 26\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{\"ok\":false,\"locked\":true}");
                                            stream.Write(lockedResp, 0, lockedResp.Length);
                                            return;
                                        }
                                        throw;
                                    }
                                    string escapedPath = fullChosen.Replace("\\", "\\\\").Replace("\"", "\\\"");
                                    string escapedName = Path.GetFileName(fullChosen).Replace("\\", "\\\\").Replace("\"", "\\\"");
                                    string jsonStr = "{\"ok\":true,\"filePath\":\"" + escapedPath + "\",\"fileName\":\"" + escapedName + "\"}";
                                    byte[] jsonBytes = Encoding.UTF8.GetBytes(jsonStr);
                                    string okHdr =
                                        "HTTP/1.1 200 OK\r\n" +
                                        "Content-Type: application/json; charset=utf-8\r\n" +
                                        "Content-Length: " + jsonBytes.Length + "\r\n" +
                                        "Access-Control-Allow-Origin: *\r\n" +
                                        "Connection: close\r\n\r\n";
                                    byte[] okHdrBytes = Encoding.ASCII.GetBytes(okHdr);
                                    stream.Write(okHdrBytes, 0, okHdrBytes.Length);
                                    stream.Write(jsonBytes, 0, jsonBytes.Length);
                                    stream.Flush();
                                    return;
                                }
                            }
                            byte[] badResp = Encoding.ASCII.GetBytes("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                            stream.Write(badResp, 0, badResp.Length);
                            return;
                        }

                        // API persistente su disco per Tool Chest (%LOCALAPPDATA%\OpenRevu\toolchest_data.json)
                        if (urlPath == "/__api/toolchest")
                        {
                            if (method == "OPTIONS")
                            {
                                byte[] opt = Encoding.ASCII.GetBytes(
                                    "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n"
                                );
                                stream.Write(opt, 0, opt.Length);
                                return;
                            }
                            if (method == "POST" && contentLength > 0 && contentLength < 64 * 1024 * 1024)
                            {
                                byte[] reqBody = new byte[contentLength];
                                int readTotal = 0;
                                while (readTotal < contentLength)
                                {
                                    int r = stream.Read(reqBody, readTotal, contentLength - readTotal);
                                    if (r <= 0) break;
                                    readTotal += r;
                                }
                                if (readTotal > 0)
                                {
                                    lock (_storageLock)
                                    {
                                        string tmpPath = ToolChestStoragePath + ".tmp";
                                        File.WriteAllBytes(tmpPath, reqBody);
                                        if (File.Exists(ToolChestStoragePath)) File.Delete(ToolChestStoragePath);
                                        File.Move(tmpPath, ToolChestStoragePath);
                                    }
                                }
                                byte[] okResp = Encoding.ASCII.GetBytes(
                                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{\"ok\":true}"
                                );
                                stream.Write(okResp, 0, okResp.Length);
                                return;
                            }
                            byte[] jsonBytes;
                            lock (_storageLock)
                            {
                                jsonBytes = File.Exists(ToolChestStoragePath)
                                    ? File.ReadAllBytes(ToolChestStoragePath)
                                    : Encoding.UTF8.GetBytes("{}");
                            }
                            string getHeader =
                                "HTTP/1.1 200 OK\r\n" +
                                "Content-Type: application/json; charset=utf-8\r\n" +
                                "Content-Length: " + jsonBytes.Length + "\r\n" +
                                "Access-Control-Allow-Origin: *\r\n" +
                                "Cache-Control: no-store\r\n" +
                                "Connection: close\r\n\r\n";
                            byte[] getHdrBytes = Encoding.ASCII.GetBytes(getHeader);
                            stream.Write(getHdrBytes, 0, getHdrBytes.Length);
                            stream.Write(jsonBytes, 0, jsonBytes.Length);
                            stream.Flush();
                            return;
                        }

                        if (urlPath == "/" || urlPath == "")
                            urlPath = "/index.html";

                        string relPath = urlPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                        string fullPath = Path.GetFullPath(Path.Combine(DistDir, relPath));

                        // Protezione da path traversal
                        if (!fullPath.StartsWith(Path.GetFullPath(DistDir), StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath))
                        {
                            fullPath = Path.Combine(DistDir, "index.html");
                        }

                        if (!File.Exists(fullPath))
                        {
                            byte[] notFound = Encoding.UTF8.GetBytes("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                            stream.Write(notFound, 0, notFound.Length);
                            return;
                        }

                        byte[] body = File.ReadAllBytes(fullPath);
                        string mime = GetMimeType(Path.GetExtension(fullPath));
                        string header =
                            "HTTP/1.1 200 OK\r\n" +
                            "Content-Type: " + mime + "\r\n" +
                            "Content-Length: " + body.Length + "\r\n" +
                            "Access-Control-Allow-Origin: *\r\n" +
                            "Cache-Control: no-cache\r\n" +
                            "Connection: close\r\n\r\n";

                        byte[] headerBytes = Encoding.ASCII.GetBytes(header);
                        stream.Write(headerBytes, 0, headerBytes.Length);
                        stream.Write(body, 0, body.Length);
                        stream.Flush();
                    }
                }
                catch
                {
                    // Connessione chiusa dal client
                }
            }
        }

        private static string RegexReplaceInvalidChars(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "utente";
            var sb = new StringBuilder();
            foreach (char c in name.Trim())
            {
                if (char.IsLetterOrDigit(c) || c == '_' || c == '-' || c == '.')
                    sb.Append(c);
                else
                    sb.Append('_');
            }
            string res = sb.ToString().Trim('_');
            return string.IsNullOrEmpty(res) ? "utente" : res;
        }

        private static string GetMimeType(string ext)
        {
            if (string.IsNullOrEmpty(ext)) return "application/octet-stream";
            switch (ext.ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".js":
                case ".mjs":
                case ".cjs": return "application/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".ico": return "image/x-icon";
                case ".pdf": return "application/pdf";
                case ".bcmap": return "application/octet-stream";
                case ".wasm": return "application/wasm";
                case ".ttf": return "font/ttf";
                case ".otf": return "font/otf";
                case ".woff": return "font/woff";
                case ".woff2": return "font/woff2";
                default: return "application/octet-stream";
            }
        }

        // Metodo separato (NoInlining) così il JIT risolve Microsoft.Web.WebView2 solo dopo l'estrazione delle DLL e la registrazione di AssemblyResolve
        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static void RunWebViewWindow()
        {
            string url = "http://127.0.0.1:" + ServerPort + "/";
            Form form = new Form();
            _mainForm = form;
            form.Text = "OpenRevu CAD Rev 2 - Precision PDF Markup & Inspection";
            form.Width = 1440;
            form.Height = 900;
            form.MinimumSize = new Size(1024, 680);
            form.StartPosition = FormStartPosition.CenterScreen;
            form.WindowState = FormWindowState.Maximized;
            form.BackColor = Color.FromArgb(24, 24, 24);

            try
            {
                form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch { }

            var webView = new Microsoft.Web.WebView2.WinForms.WebView2();
            webView.Dock = DockStyle.Fill;
            webView.DefaultBackgroundColor = Color.FromArgb(24, 24, 24);
            form.Controls.Add(webView);

            form.Load += async (s, e) =>
            {
                try
                {
                    string userDataDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "OpenRevu",
                        "UserData"
                    );
                    var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, userDataDir);
                    await webView.EnsureCoreWebView2Async(env);
                    webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                    webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                    webView.CoreWebView2.Settings.IsZoomControlEnabled = false;
                    webView.CoreWebView2.WebMessageReceived += (ws, we) =>
                    {
                        try
                        {
                            string msg = we.TryGetWebMessageAsString();
                            if (!string.IsNullOrEmpty(msg) && msg.Contains("\"dirty_state\""))
                            {
                                _hasDirtyDocs = msg.Contains("\"hasDirty\":true");
                            }
                        }
                        catch { }
                    };
                    webView.CoreWebView2.Navigate(url);
                }
                catch
                {
                    // Fallback su Microsoft Edge in modalità App nativa
                    Process.Start("msedge.exe", "--app=" + url);
                    form.Close();
                }
            };

            form.FormClosing += (s, e) =>
            {
                if (_hasDirtyDocs)
                {
                    var res = MessageBox.Show(
                        "Ci sono documenti con modifiche non salvate.\nVuoi chiudere comunque senza salvare?",
                        "OpenRevu CAD - Modifiche non salvate",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning,
                        MessageBoxDefaultButton.Button2
                    );
                    if (res != DialogResult.Yes)
                    {
                        e.Cancel = true;
                    }
                }
            };

            Application.Run(form);
        }
    }
}
