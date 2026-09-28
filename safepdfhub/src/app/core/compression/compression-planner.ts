import { Injectable } from '@angular/core';
import { CompressionPlan } from './compression-plan';
import { PageAnalysis, PdfAnalysis } from './pdf-analysis.models';

@Injectable({ providedIn: 'root' })
export class CompressionPlanner {
  createPlan(analysis: PdfAnalysis, pages: number, level: 'light' | 'recommended' | 'strong'): CompressionPlan {
    let reduction = 0;
    switch (analysis.type) {
      case 'text':
        reduction = analysis.imageCount > 0 ? 8 + analysis.imageRatio * 12 : 8;
        break;
      case 'mixed':
        reduction = 18 + analysis.imageRatio * 35;
        break;
      case 'scanned':
        reduction = 35 + analysis.imageRatio * 25;
        break;
    }

    if (analysis.imageHeavy) reduction += 8;
    if (analysis.largePages) reduction += 10;

    switch (level) {
      case 'light': reduction *= 0.6; break;
      case 'recommended': break;
      case 'strong': reduction *= 1.4; break;
    }

    reduction = Math.max(reduction, 3);
    reduction = Math.min(Math.round(reduction), 80);

    if (pages > 1000) reduction = Math.min(reduction, 10);

    return {
      strategy: this.chooseStrategy(analysis),
      quality: this.chooseQuality(analysis, level),
      scale: this.chooseScale(analysis, level),
      maxWidth: this.chooseMaxWidth(level),
      maxHeight: this.chooseMaxHeight(level),
      estimatedReduction: reduction,
    };
  }

  private chooseStrategy(analysis: PdfAnalysis): 'safe' | 'smart' | 'strong' {
    if (analysis.type === 'scanned') return 'strong';
    if (analysis.type === 'mixed' || analysis.imageCount > 0) return 'smart';
    return 'safe';
  }

  private chooseQuality(analysis: PdfAnalysis, level: 'light' | 'recommended' | 'strong'): number {
    if (analysis.imageCount === 0) return 1;
    switch (level) {
      case 'light': return 0.90;
      case 'recommended': return 0.80;
      case 'strong': return 0.65;
    }
  }

  private chooseScale(analysis: PdfAnalysis, level: 'light' | 'recommended' | 'strong'): number {
    if (analysis.imageCount === 0) return 1;
    switch (level) {
      case 'light': return 1;
      case 'recommended': return 0.85;
      case 'strong': return 0.65;
    }
  }

  private chooseMaxWidth(level: 'light' | 'recommended' | 'strong'): number {
    return level === 'light' ? 2400 : level === 'recommended' ? 1400 : 1000;
  }

  private chooseMaxHeight(level: 'light' | 'recommended' | 'strong'): number {
    return level === 'light' ? 3200 : level === 'recommended' ? 1900 : 1400;
  }

  getAdaptiveQuality(plan: CompressionPlan, analysis: PdfAnalysis | PageAnalysis): number {
    if (analysis.type === 'text' && analysis.imageCount === 0) return 1;
    if (analysis.type === 'scanned') return Math.min(plan.quality, plan.quality * 0.8);
    return plan.quality;
  }

  getAdaptiveScale(plan: CompressionPlan, viewport: { width: number; height: number }, analysis: PageAnalysis): number {
    const max = Math.max(viewport.width, viewport.height);
    if (!analysis.shouldRasterize) return 1;
    if (plan.scale === 1) return max > 2500 ? 0.90 : 1;
    if (plan.scale === 0.85) return max > 2500 ? 0.70 : 0.85;
    return max > 2500 ? 0.50 : 0.65;
  }

  getObjectsPerTick(level: 'light' | 'recommended' | 'strong'): number {
    return level === 'light' ? 80 : level === 'recommended' ? 50 : 25;
  }
}
