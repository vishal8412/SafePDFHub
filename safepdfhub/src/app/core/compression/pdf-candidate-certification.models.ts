import { PdfFinalIntegrityResult } from './pdf-final-integrity.models';

export interface PdfCandidateCertificationEvaluation {
  candidate: File;
  fingerprint: string;
  result: PdfFinalIntegrityResult;
  cacheHit: boolean;
  duplicateOfFingerprint: string | null;
}

export interface PdfCandidateCertificationRun {
  sourceFingerprint: string;
  candidatesConsidered: number;
  uniqueCandidatesCertified: number;
  cacheHits: number;
  duplicateCandidatesSkipped: number;
  evaluations: PdfCandidateCertificationEvaluation[];
  selected: File | null;
  durationMs: number;
}
