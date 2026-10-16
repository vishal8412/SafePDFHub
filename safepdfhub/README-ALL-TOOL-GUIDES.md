# Shared guide design for all tools

The approved Compress PDF guide design is now a shared standalone ToolGuideComponent. Merge PDF, Split PDF, Protect PDF, Unlock PDF, Sign PDF, Watermark PDF, PDF to Word, Word to PDF and Compress PDF all use the same illustrated step cards, tip, keyboard-accessible FAQs, privacy links and responsive layout.

Each tool has its own headings, card labels and practical tip. Workflow steps and existing FAQ answers still come from the unchanged TOOL_GUIDES configuration. PDF to Word retains the explanation of Editable text (including OCR language/positioned-text limitations) and Keep page appearance.

Scope: new shared guide component/template/styles and a presentation-copy map. ToolComponent changes only its guide import/standalone declaration and landing-guide markup/styles. All controller method bodies, business logic, file validators, engines, workers, services, upload handlers and result workflows are unchanged. Existing older WordGuide source is retained for reference; it is no longer rendered on the tool page.

Validation: production build passed. Browser checks passed on all 9 tool routes: 3 numbered steps, expected FAQ count/content headings, Enter/Space keyboard toggling, file chooser activation, PDF-to-Word output-choice explanations, and no horizontal overflow at 1440/768/390/320px. Representative desktop/mobile screenshots were reviewed internally. This update did not rerun all eight complete conversion/processing pipelines; source comparison confirms their processing code is unchanged.

Run: stop your old development server, extract this complete project into a fresh folder, enter SafePDFHub, then npm ci and npm start.
