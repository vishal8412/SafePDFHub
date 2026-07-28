export interface PdfAnalysis {

    type:
        | 'text'
        | 'scanned'
        | 'mixed';

    avgTextDensity: number;

    estimatedDpi: number;

    largePages: boolean;

    imageHeavy: boolean;

    imageRatio: number;

}

export interface PdfFileAnalysis {

    type:
        | 'text'
        | 'scanned'
        | 'mixed';

    analysis: PdfAnalysis;

    pages: number;

}

export interface PageAnalysis {

    type:
        | 'text'
        | 'scanned'
        | 'mixed';

    textDensity: number;

    estimatedImageArea: number;

    estimatedPhotoPage: boolean;

    shouldRasterize: boolean;

}