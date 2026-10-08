import { Component, inject } from '@angular/core';
import { UnsavedWorkService } from '../../../core/guards/unsaved-work.service';
import { DialogFocusDirective } from './dialog-focus.directive';
@Component({
  selector: 'app-unsaved-work-dialog',
  imports: [DialogFocusDirective],
  template: `@if (work.prompt()) {
    <div class="exit-backdrop">
      <section
        class="exit-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exit-title"
        aria-describedby="exit-description"
        appDialogFocus
        (dialogEscape)="work.resolve(false)"
      >
        <div class="exit-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" stroke-width="1.6" />
            <path d="M14 3v5h4M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.6" />
          </svg>
        </div>
        <h2 id="exit-title">Keep your PDF changes?</h2>
        <p id="exit-description">
          Your latest changes haven’t been downloaded.
          {{ work.prompt() === 'replace' ? 'Replacing this PDF' : 'Leaving the editor' }} will
          discard them.
        </p>
        <p class="exit-hint">Stay in Studio and export your PDF to keep your work.</p>
        <div class="exit-actions">
          <button class="keep" (click)="work.resolve(false)">Keep editing</button
          ><button class="leave" (click)="work.resolve(true)">
            {{ work.prompt() === 'replace' ? 'Replace PDF' : 'Leave without downloading' }}
          </button>
        </div>
      </section>
    </div>
  }`,
  styles: [
    `
      :host {
        font-family: inherit;
      }
      .exit-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10000;
        background: rgba(3, 9, 17, 0.76);
        backdrop-filter: blur(5px);
        display: grid;
        place-items: center;
        padding: 20px;
      }
      .exit-dialog {
        width: 100%;
        max-width: 440px;
        box-sizing: border-box;
        background: #142238;
        border: 1px solid #33465e;
        border-radius: 18px;
        padding: 28px;
        color: #eef5ff;
        box-shadow: 0 24px 80px #0008;
      }
      .exit-icon {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        background: #ff87341a;
        color: #ff9b56;
      }
      .exit-icon svg {
        width: 26px;
        height: 26px;
      }
      h2 {
        font-size: 21px;
        margin: 18px 0 10px;
      }
      p {
        font-size: 14px;
        line-height: 1.6;
        color: #c4d1e1;
        margin: 0;
      }
      .exit-hint {
        font-size: 12px;
        margin-top: 12px;
        color: #91a8c3;
      }
      .exit-actions {
        display: flex;
        flex-direction: column;
        gap: 9px;
        margin-top: 24px;
      }
      button {
        font-family: inherit;
        font-weight: 650;
        font-size: 13px;
        border-radius: 9px;
        min-height: 42px;
        cursor: pointer;
      }
      .keep {
        background: #ff8838;
        color: #172136;
        border: 1px solid #ff9b56;
      }
      .leave {
        background: #1a2b42;
        color: #d5dfec;
        border: 1px solid #3d516d;
      }
      button:focus-visible {
        outline: 2px solid #67ddcd;
        outline-offset: 3px;
      }
    `,
  ],
})
export class UnsavedWorkDialogComponent {
  readonly work = inject(UnsavedWorkService);
}
