Studio Shell

The Studio Shell is a presentation/composition component.
It owns the high-level Studio region structure but contains
no PDF business logic.

The shell composes:

- Studio Header
- Studio Toolbar
- Studio Workspace
- Studio Status Bar

The Workspace owns the primary editing regions:

- Left Sidebar
- Canvas
- Right Sidebar

PDF processing and document state remain outside the shell.


Studio Workspace

The Studio Workspace is responsible for the three primary
editing regions:

- Left Sidebar
- Canvas
- Right Sidebar

The Workspace contains presentation structure only.

PDF rendering, document state, selection state, page management,
and editing operations are provided by the Studio Facade and
underlying PDF services.

The Workspace uses a zero-gap three-column layout:

280px | flexible canvas | 300px



Studio Toolbar

The Studio Toolbar is a presentation-only component.

Responsibilities:
- Render available Studio tools.
- Maintain the currently selected UI tool.
- Emit tool selection events.
- Provide keyboard-accessible controls.
- Provide visual active/hover/disabled states.

The toolbar does not:
- Modify PDFs.
- Access pdf.js.
- Access pdf-lib.
- Manage document state.
- Manage history.
- Execute editing commands.

Tool execution is handled by the Studio Facade and downstream
PDF services.