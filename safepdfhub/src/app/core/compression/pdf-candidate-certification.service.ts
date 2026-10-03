import { Injectable } from '@angular/core';
import { PdfFinalIntegrityResult } from './pdf-final-integrity.models';
import {
  PdfCandidateCertificationEvaluation,
  PdfCandidateCertificationRun,
} from './pdf-candidate-certification.models';
import { PdfFinalIntegrityService } from './pdf-final-integrity.service';
import { throwIfCompressionCancelled } from './compression-cancellation';

interface CachedCertification {
  result: PdfFinalIntegrityResult;
  fingerprint: string;
}

/**
 * V2.7 candidate orchestration layer.
 *
 * Candidate generation can produce byte-identical PDFs through different
 * optimization paths. This service fingerprints candidate bytes, removes
 * duplicate certification work, and caches final-integrity results for the
 * lifetime of the browser service instance.
 *
 * The cache is intentionally bounded and never changes the integrity contract:
 * a candidate is eligible only when PdfFinalIntegrityService reports `passed`.
 */
@Injectable({ providedIn: 'root' })
export class PdfCandidateCertificationService {
  private readonly certificationCache = new Map<string, CachedCertification>();
  private readonly maxCacheEntries = 32;

  constructor(
    private readonly finalIntegrity: PdfFinalIntegrityService,
  ) {}

  async certifySmallest(
    source: File,
    candidates: readonly (File | null | undefined)[],
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
    level: 'light' | 'recommended' | 'strong' = 'light',
  ): Promise<PdfCandidateCertificationRun> {
    const startedAt = performance.now();
    const smallerCandidates = candidates
      .filter((candidate): candidate is File => candidate !== null && candidate !== undefined && candidate.size < source.size)
      .sort((a, b) => a.size - b.size);

    throwIfCompressionCancelled(signal);
    const sourceFingerprint = await this.fingerprint(source);
    throwIfCompressionCancelled(signal);
    const evaluations: PdfCandidateCertificationEvaluation[] = [];
    const fingerprintToFirstCandidate = new Map<string, File>();
    let cacheHits = 0;
    let duplicateCandidatesSkipped = 0;
    let uniqueCandidatesCertified = 0;
    let selected: File | null = null;

    for (let index = 0; index < smallerCandidates.length; index += 1) {
      throwIfCompressionCancelled(signal);
      const candidate = smallerCandidates[index];
      const fingerprint = await this.fingerprint(candidate);
      const firstCandidate = fingerprintToFirstCandidate.get(fingerprint);

      if (firstCandidate) {
        duplicateCandidatesSkipped += 1;
        const cached = this.certificationCache.get(this.cacheKey(sourceFingerprint, fingerprint, level));
        if (cached) {
          cacheHits += 1;
          evaluations.push({
            candidate,
            fingerprint,
            result: cached.result,
            cacheHit: true,
            duplicateOfFingerprint: fingerprint,
          });
          if (cached.result.status === 'passed') {
            selected = candidate;
            break;
          }
        }
        onProgress?.(this.progressFor(index + 1, smallerCandidates.length));
        continue;
      }

      fingerprintToFirstCandidate.set(fingerprint, candidate);
      const key = this.cacheKey(sourceFingerprint, fingerprint, level);
      const cached = this.certificationCache.get(key);

      let result: PdfFinalIntegrityResult;
      let cacheHit = false;

      if (cached) {
        result = cached.result;
        cacheHit = true;
        cacheHits += 1;
      } else {
        uniqueCandidatesCertified += 1;
        result = await this.finalIntegrity.certify(
          source,
          candidate,
          progress => onProgress?.(this.progressFor(index + progress / 100, smallerCandidates.length)),
          signal,
          level,
        );
        throwIfCompressionCancelled(signal);
        this.putCache(key, { result: this.compactResult(result), fingerprint });
      }

      evaluations.push({
        candidate,
        fingerprint,
        result,
        cacheHit,
        duplicateOfFingerprint: null,
      });

      if (result.status === 'passed') {
        selected = candidate;
        onProgress?.(100);
        break;
      }

      onProgress?.(this.progressFor(index + 1, smallerCandidates.length));
    }

    throwIfCompressionCancelled(signal);
    onProgress?.(100);

    return {
      sourceFingerprint,
      candidatesConsidered: smallerCandidates.length,
      uniqueCandidatesCertified,
      cacheHits,
      duplicateCandidatesSkipped,
      evaluations,
      selected,
      durationMs: performance.now() - startedAt,
    };
  }

  clearCache(): void {
    this.certificationCache.clear();
  }

  private cacheKey(sourceFingerprint: string, candidateFingerprint: string, level: string): string {
    return `${sourceFingerprint}:${candidateFingerprint}:${level}`;
  }

  private compactResult(result: PdfFinalIntegrityResult): PdfFinalIntegrityResult {
    // Full V2.6 results can contain one page record per page. Keeping all of
    // those records in a cross-run cache would multiply memory usage for large
    // PDFs, so cache only the certification summary; the authoritative result
    // for a fresh candidate is still retained in the current run's evaluation.
    return {
      ...result,
      pages: [],
    };
  }

  private putCache(key: string, value: CachedCertification): void {
    if (this.certificationCache.size >= this.maxCacheEntries) {
      const oldestKey = this.certificationCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.certificationCache.delete(oldestKey);
      }
    }
    this.certificationCache.set(key, value);
  }

  private progressFor(completedUnits: number, totalUnits: number): number {
    if (totalUnits <= 0) return 100;
    return 90 + Math.round((Math.min(completedUnits, totalUnits) / totalUnits) * 10);
  }

  private async fingerprint(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const cryptoApi = globalThis.crypto;

    if (cryptoApi?.subtle) {
      const ownedBytes = new Uint8Array(bytes.byteLength);
      ownedBytes.set(bytes);
      const digest = await cryptoApi.subtle.digest('SHA-256', ownedBytes.buffer);
      return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    }

    let hash = 2166136261;
    for (let index = 0; index < bytes.length; index += 1) {
      hash ^= bytes[index];
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}:${bytes.length}`;
  }
}
