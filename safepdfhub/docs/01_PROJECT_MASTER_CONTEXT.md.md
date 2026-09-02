# PROJECT_MASTER_CONTEXT.md

> Project: SafePDFHub
> Status: Living Document

## 1. Executive Summary
SafePDFHub is a privacy-first browser-based PDF platform focused on premium UX, enterprise architecture, performance and browser processing.

## 2. Vision
- Privacy First
- Browser Processing
- Premium UI
- Enterprise Quality
- SEO Friendly
- High Performance

## 3. Business Goals
Target: USA, Europe, Australia
Revenue:
- Ads (minimal)
- Premium
- Sponsors
- AI (future)

## 4. Current Status
Completed:
- Merge PDF
- Split PDF
- Compress PDF

Current:
- SafePDFHub Studio

## 5. Roadmap
Studio
Protect
Unlock
Watermark
Rotate
OCR
AI
Collaboration

## 6. Studio Layout
Header
Toolbar
Workspace
  - Left Sidebar
  - Canvas
  - Right Sidebar
Status Bar

## 7. Color Rules
Primary: #00D4B3
Accent: #FF9A3D
Background: #0A1626

## 8. Architecture
UI
→ Facade
→ Signals State
→ Services
→ pdf.js

## 9. Folder Structure
features/studio/
- shell
- header
- toolbar
- workspace
- left-sidebar
- canvas
- right-sidebar
- status-bar
- facade
- state
- services
- models
- utils

## 10. Coding Standards
- Angular Standalone
- OnPush
- Strong typing
- Reusable architecture
- No business logic in components
- Component <=300 lines preferred
- Service <=500 lines preferred

## 11. Engineering Rules
- Architecture first
- Reusable UI
- One responsibility per class
- No duplicate CSS

## 12. Development Workflow
Discuss
Approve
Freeze
Implement
Review
Commit

## 13. Git Strategy
One milestone = one commit.

## 14. Lessons Learned
- Avoid giant tool components.
- Use facades.
- Move viewer logic into services.

## 15. Promises
- Production-ready code
- TS + HTML + SCSS
- Integration instructions
- Verification checklist

## 16. Current Milestone
Milestone 1: Studio Foundation

## 17. Future Features
OCR
AI
Command Palette
Version History
Cloud Sync

## 18. Next Task
Build Studio Shell Foundation before PDF rendering.

This document should be updated after every completed milestone.
