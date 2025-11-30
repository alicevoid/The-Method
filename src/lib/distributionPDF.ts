// ============================================================================
// DISTRIBUTION PDF CALCULATION MODULE
// ============================================================================
//
// HOW THIS WORKS:
// ---------------
// This file turns your distribution settings (type, center, spread) into
// visual curves by calculating the mathematical "height" at each point.
//
// CRUCIAL LINES:
// - Line 24-38: calculatePDF() - Main router that picks the right math formula
// - Line 44-52: calculateUniformPDF() - Flat line (all values equal chance)
// - Line 58-68: calculateNormalPDF() - Classic bell curve formula
// - Line 74-87: calculateTDistributionPDF() - Bell curve with fatter tails
// - Line 120-137: generatePDFCurve() - Creates array of heights for the graph
//
// ============================================================================

import type { DistributionType, DistributionConfig } from './randomness';

// ============================================================================
// MAIN PDF ROUTER - Picks which formula to use
// ============================================================================

/**
 * CRUCIAL FUNCTION: Routes to the correct mathematical formula
 *
 * @param type - Which distribution shape (uniform/bell/z-curve/t-curve)
 * @param x - Where we are on the graph (0 to 1, left to right)
 * @param center - Where the peak should be (0 to 1)
 * @param spread - How wide the curve is (0 to 1)
 * @param degreesOfFreedom - Controls tail heaviness for t-curve
 * @returns Height of the curve at position x (for drawing)
 */
export function calculatePDF(
    type: DistributionType,
    x: number,
    center: number,
    spread: number,
    degreesOfFreedom?: number
): number {
    // Pick the right formula based on type
    switch (type) {
        case 'uniform':
            return calculateUniformPDF(x, center, spread);

        case 'bell':
        case 'z-curve':
            return calculateNormalPDF(x, center, spread);

        case 't-curve':
            return calculateTDistributionPDF(x, center, spread, degreesOfFreedom || 5);

        default:
            return 0;
    }
}

/**
 * UNIFORM DISTRIBUTION - Flat horizontal line
 * Returns 1.0 inside the spread range, 0 outside
 */
function calculateUniformPDF(x: number, center: number, spread: number): number {
    const halfSpread = spread / 2;
    const lowerBound = Math.max(0, center - halfSpread);
    const upperBound = Math.min(1, center + halfSpread);

    // Inside the range? Height = 1. Outside? Height = 0
    if (x >= lowerBound && x <= upperBound) {
        return 1.0;
    }
    return 0;
}

/**
 * BELL CURVE (Normal Distribution) - Classic symmetric bell shape
 * Formula: (1 / (σ√(2π))) * e^(-(x-μ)²/(2σ²))
 * Translation: Height drops off exponentially as you move away from center
 */
function calculateNormalPDF(x: number, center: number, spread: number): number {
    const sigma = Math.max(spread * 0.4, 0.02); // Convert spread to "standard deviation"

    const distance = x - center; // How far from the peak?
    const exponent = -(distance * distance) / (2 * sigma * sigma); // Exponential dropoff
    const coefficient = 1 / (sigma * Math.sqrt(2 * Math.PI)); // Normalization constant

    // The famous bell curve formula!
    return coefficient * Math.exp(exponent);
}

/**
 * Student's t-distribution PDF - bell curve with heavier tails
 * Formula: Γ((ν+1)/2) / (√(νπ) * Γ(ν/2)) * (1 + t²/ν)^(-(ν+1)/2)
 * where ν is degrees of freedom and t is the scaled x value
 */
function calculateTDistributionPDF(
    x: number,
    center: number,
    spread: number,
    degreesOfFreedom: number
): number {
    const scale = Math.max(spread * 0.4, 0.02);
    const t = (x - center) / scale;
    const df = degreesOfFreedom;

    // Calculate t-distribution PDF using log-gamma for numerical stability
    const numerator = Math.exp(logGamma((df + 1) / 2));
    const denominator = Math.sqrt(df * Math.PI) * Math.exp(logGamma(df / 2));
    const base = 1 + (t * t) / df;
    const power = -(df + 1) / 2;

    return (numerator / denominator) * Math.pow(base, power) / scale;
}

/**
 * Log-gamma function approximation using Stirling's formula
 * Used for t-distribution calculations
 */
function logGamma(x: number): number {
    // Stirling's approximation: ln(Γ(x)) ≈ (x - 0.5) * ln(x) - x + 0.5 * ln(2π)
    if (x <= 0) return 0;

    // For small values, use lookup table for better accuracy
    const gammaLookup: { [key: number]: number } = {
        0.5: 0.5723649429247001, // ln(√π)
        1: 0,                     // ln(1)
        1.5: -0.1207822376352452, // ln(√π/2)
        2: 0,                     // ln(1)
        2.5: 0.2846828704729192,  // ln(3√π/4)
        3: 0.6931471805599453,    // ln(2)
    };

    if (gammaLookup[x] !== undefined) {
        return gammaLookup[x];
    }

    // Stirling's formula for larger values
    return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI);
}

// ============================================================================
// CURVE GENERATION FOR VISUALIZATION
// ============================================================================

/**
 * CRUCIAL FUNCTION: Generates the full curve for the graph!
 *
 * This is what the DistributionGraph component calls to get the curve shape.
 *
 * @param config - Your settings (type, center, spread, etc.)
 * @param pointCount - How many dots to draw (101 for integer, 200 for date)
 * @returns Array of heights from 0 to 1 (one for each x position)
 */
export function generatePDFCurve(
    config: DistributionConfig,
    pointCount: number = 101
): number[] {
    const data: number[] = [];

    // Step through each position on the graph (left to right)
    for (let i = 0; i < pointCount; i++) {
        const x = i / (pointCount - 1); // Convert index to 0-1 position

        // Calculate height at this position using the right formula
        const pdf = calculatePDF(
            config.type,
            x,
            config.center,
            config.spread,
            config.degreesOfFreedom
        );
        data.push(pdf);
    }

    // Scale all heights so the tallest point = 1.0 (fills the graph nicely)
    const maxValue = Math.max(...data, 0.0001);
    return data.map(v => v / maxValue);
}

/**
 * Generates labeled data points for a date-based distribution graph
 *
 * @param config - Distribution configuration
 * @param startDate - Start of date range
 * @param endDate - End of date range
 * @param pointCount - Number of points to generate
 * @returns Array of {date: Date, pdf: number} objects
 */
export function generateDatePDFCurve(
    config: DistributionConfig,
    startDate: Date,
    endDate: Date,
    pointCount: number = 100
): Array<{ date: Date; pdf: number }> {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    const range = endTime - startTime;

    const data: Array<{ date: Date; pdf: number }> = [];

    // Generate raw PDF values
    for (let i = 0; i < pointCount; i++) {
        const x = i / (pointCount - 1); // Normalize to 0-1
        const pdf = calculatePDF(
            config.type,
            x,
            config.center,
            config.spread,
            config.degreesOfFreedom
        );

        const time = startTime + (x * range);
        data.push({
            date: new Date(time),
            pdf: pdf
        });
    }

    // Normalize PDF values to max of 1.0
    const maxPDF = Math.max(...data.map(d => d.pdf), 0.0001);
    return data.map(d => ({
        date: d.date,
        pdf: d.pdf / maxPDF
    }));
}
