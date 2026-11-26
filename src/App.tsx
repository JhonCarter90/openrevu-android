import React, { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { PDFManager } from '@/core/pdf/pdfManager';
import { loadStartupNativeFileIfPresent } from '@/core/storage/pdfFileService';
import { TopHeader } from '@/components/toolbar/TopHeader';
import { BluebeamMenuBar } from '@/components/toolbar/BluebeamMenuBar';
import { DocumentTabBar } from '@/components/navigation/DocumentTabBar';
import { MainToolbar } from '@/components/toolbar/MainToolbar';
import { ContextualLinePropertiesBar } from '@/components/toolbar/ContextualLinePropertiesBar';
import { LeftPanelContainer } from '@/components/panels/LeftPanelContainer';
import { SplitViewerContainer } from '@/components/canvas/SplitViewerContainer';
import { PropertiesSidebar } from '@/components/properties/PropertiesSidebar';
import { MarkupsListPanel } from '@/components/markups-list/MarkupsListPanel';
import { CADStatusBar } from '@/components/statusbar/CADStatusBar';
import { HomePage } from '@/components/home/HomePage';
import { ColorProcessingModal } from '@/components/modals/ColorProcessingModal';
import { InsertPagesModal } from '@/components/modals/InsertPagesModal';
import { HyperlinkActionModal } from '@/components/modals/HyperlinkActionModal';

export const App: React.FC = () => {
  const { openMultipleDocuments, activeDocumentId, openDocuments } = useAppStore();

  useEffect(() => {
    void loadStartupNativeFileIfPresent();
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasDirty = useAppStore.getState().openDocuments.some((d) => Boolean(d.isDirty));
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [openDocuments]);

  const handleDropFiles = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const pdfManager = PDFManager.getInstance();
    const loadedDocs: {
      id: string;
      fileName: string;
      bytes: Uint8Array;
      numPages: number;
      pagesInfo: any[];
      markups: any[];
    }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.toLowerCase().endsWith('.pdf')) continue;
      try {
        const buffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(buffer);
        const docId = crypto.randomUUID();
        const { numPages, pagesInfo, existingMarkups } = await pdfManager.loadDocument(uint8, docId);
        loadedDocs.push({
          id: docId,
          fileName: file.name,
          bytes: uint8,
          numPages,
          pagesInfo,
          markups: existingMarkups,
        });
      } catch (err) {
        console.error(`Errore apertura file trascinato [${file.name}]:`, err);
      }
    }

    if (loadedDocs.length > 0) {
      openMultipleDocuments(loadedDocs);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={handleDropFiles}
      className="flex flex-col h-screen w-screen bg-[#141415] overflow-hidden text-[#ededed] select-none font-sans"
    >
      {/* 1. Header Superiore */}
      <TopHeader />

      {/* 2. Menu Bar Stile Bluebeam (File, Modifica, Visualizza, Documento, Strumenti, Finestra) */}
      <BluebeamMenuBar />

      {/* 3. Barra Schede Documenti (Document Tabs stile Bluebeam) */}
      <DocumentTabBar />

      {activeDocumentId === 'home' ? (
        /* Schermata Iniziale / Home Page (Recenti, Nuovo Disegno Formati, Apri File Multipli) */
        <HomePage />
      ) : (
        <>
          {/* Barra Strumenti Disegno e Annotazione */}
          <MainToolbar />

          {/* Barra Proprietà Contestuale Stile Bluebeam (Linea, Inizio, Fine, Spessore, Opacità, Stile) */}
          <ContextualLinePropertiesBar />

          {/* Area di Lavoro Centrale (Pannelli Sinistri a Schede + Split Container + Proprietà Destra) */}
          <div className="flex flex-1 overflow-hidden relative">
            <LeftPanelContainer />
            <SplitViewerContainer />
            <PropertiesSidebar />
          </div>

          {/* Barra di Stato e Navigazione CAD (sopra Elenco Marcature, stile Bluebeam Revu originale) */}
          <CADStatusBar />

          {/* Pannello Inferiore (Markups List) */}
          <MarkupsListPanel />
        </>
      )}
      <ColorProcessingModal />
      <InsertPagesModal />
      <HyperlinkActionModal />
    </div>
  );
};
