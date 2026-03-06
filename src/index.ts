// Main entry point for shape-tool package
// Re-exports core utilities that can be used standalone
export { traceFromImage, fitCurve } from './lib/bezier-fit';
export { cannyEdgeDetection, marchingSquaresMulti, analyzeImage } from './lib/contour';
