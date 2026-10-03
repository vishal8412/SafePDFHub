import { PdfVisualFidelityResult } from './pdf-visual-fidelity.models';
import { PdfSemanticIntegrityResult } from './pdf-semantic-integrity.models';

export type PdfImageOptimizationRisk = 'none' | 'low' | 'medium' | 'high';

export interface PdfImageOptimizationCandidate {
  quality: number;
  file: File;
  inputBytes: number;
  outputBytes: number;
  reductionBytes: number;
  reductionPercent: number;
  valid: boolean;
  visualFidelity: PdfVisualFidelityResult | null;
  semanticIntegrity: PdfSemanticIntegrityResult | null;
  durationMs: number;
}

export interface PdfImageOptimizationResult {
  inputBytes: number;
  risk: PdfImageOptimizationRisk;
  eligible: boolean;
  skippedReason: string | null;
  attemptedQualities: number[];
  candidates: PdfImageOptimizationCandidate[];
  selected: PdfImageOptimizationCandidate | null;
}
