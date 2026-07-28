export interface CompressionResult {
  file: File;
  originalSize: number;
  finalSize: number;
  reduction: number;
  duration: string;
}

export interface CompressionEstimate {
  estimatedReduction: number;
  estimatedFinalSize: number;
}

export interface CompressionAnalysis {
    avgTextDensity: number;
    estimatedDpi: number;
    largePages: boolean;
    imageHeavy: boolean;
    imageRatio: number;
}