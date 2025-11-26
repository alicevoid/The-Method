// ============================================================================
// RANDOMNESS MODULE - Statistical Distribution Functions
// ============================================================================
// This module provides functions for generating random numbers from various
// probability distributions for YouTube video search randomization.

export type DistributionType = 'uniform' | 'bell' | 'z-curve' | 't-curve';

export interface DistributionConfig {
    type: DistributionType;
    center: number;      // 0-1 (percentage of range)
    spread: number;      // 0-1 (relative spread)
    degreesOfFreedom?: number;  // For t-curve (1-30)
}

// ============================================================================
// CORE DISTRIBUTION FUNCTIONS
// ============================================================================

/**
 * Generates a random number from a uniform distribution
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @returns Random number uniformly distributed between min and max
 */
export function uniformDistribution(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a random number from a normal (bell curve) distribution using Box-Muller transform
 * @param mean - Center of the distribution
 * @param stdDev - Standard deviation (spread)
 * @returns Random number from normal distribution
 */
export function normalDistribution(mean: number, stdDev: number): number {
    // Box-Muller transform for generating normal distribution
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random(); // Converting [0,1) to (0,1)
    while (u2 === 0) u2 = Math.random();

    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
}

/**
 * Generates a random number from a standard normal (Z-curve) distribution
 * @param mean - Center of the distribution
 * @param stdDev - Standard deviation (spread)
 * @returns Random number from standard normal distribution
 */
export function zCurveDistribution(mean: number, stdDev: number): number {
    // Z-curve is just a standard normal distribution
    return normalDistribution(mean, stdDev);
}

/**
 * Generates a random number from a Student's t-distribution (heavy tails)
 * @param mean - Center of the distribution
 * @param scale - Scale parameter (similar to standard deviation)
 * @param degreesOfFreedom - Degrees of freedom (lower = heavier tails, typically 1-30)
 * @returns Random number from t-distribution
 */
export function tDistribution(mean: number, scale: number, degreesOfFreedom: number = 5): number {
    // Generate t-distribution using normal and chi-squared approximation
    const z = normalDistribution(0, 1);

    // Approximate chi-squared with degrees of freedom
    let chiSquared = 0;
    for (let i = 0; i < degreesOfFreedom; i++) {
        const n = normalDistribution(0, 1);
        chiSquared += n * n;
    }

    const t = z / Math.sqrt(chiSquared / degreesOfFreedom);
    return mean + t * scale;
}

// ============================================================================
// CONSTRAINED RANDOM GENERATION
// ============================================================================

/**
 * Generates a random integer constrained to a range using specified distribution
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @param config - Distribution configuration
 * @param maxAttempts - Maximum attempts to find value within range (default: 100)
 * @returns Random integer within specified range
 */
export function generateConstrainedInteger(
    min: number,
    max: number,
    config: DistributionConfig,
    maxAttempts: number = 100
): number {
    if (config.type === 'uniform') {
        return uniformDistribution(min, max);
    }

    const range = max - min;
    const centerValue = min + (range * config.center);
    const stdDev = range * Math.max(config.spread, 0.05);

    let attempts = 0;
    let value: number;

    do {
        switch (config.type) {
            case 'bell':
                value = Math.round(normalDistribution(centerValue, stdDev));
                break;
            case 'z-curve':
                value = Math.round(zCurveDistribution(centerValue, stdDev));
                break;
            case 't-curve':
                value = Math.round(tDistribution(centerValue, stdDev, config.degreesOfFreedom || 5));
                break;
            default:
                value = uniformDistribution(min, max);
        }
        attempts++;
    } while ((value < min || value > max) && attempts < maxAttempts);

    // Clamp to range if we exceeded max attempts
    return Math.max(min, Math.min(max, value));
}

/**
 * Generates a random date constrained to a date range using specified distribution
 * @param startDate - Earliest date (inclusive)
 * @param endDate - Latest date (inclusive)
 * @param config - Distribution configuration
 * @param maxAttempts - Maximum attempts to find value within range (default: 100)
 * @returns Random date within specified range
 */
export function generateConstrainedDate(
    startDate: Date,
    endDate: Date,
    config: DistributionConfig,
    maxAttempts: number = 100
): Date {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    const range = endTime - startTime;

    if (config.type === 'uniform') {
        const randomTime = startTime + Math.random() * range;
        return new Date(randomTime);
    }

    const centerTime = startTime + (range * config.center);
    const stdDev = range * Math.max(config.spread, 0.05);

    let attempts = 0;
    let time: number;

    do {
        switch (config.type) {
            case 'bell':
                time = normalDistribution(centerTime, stdDev);
                break;
            case 'z-curve':
                time = zCurveDistribution(centerTime, stdDev);
                break;
            case 't-curve':
                time = tDistribution(centerTime, stdDev, config.degreesOfFreedom || 5);
                break;
            default:
                time = startTime + Math.random() * range;
        }
        attempts++;
    } while ((time < startTime || time > endTime) && attempts < maxAttempts);

    // Clamp to range if we exceeded max attempts
    const clampedTime = Math.max(startTime, Math.min(endTime, time));
    return new Date(clampedTime);
}

// ============================================================================
// VALIDATION - 80% CONSTRAINT
// ============================================================================

/**
 * Validates that a distribution configuration meets the 80% constraint
 * (80% of generated values should fall within the specified range)
 * @param config - Distribution configuration to validate
 * @param min - Minimum value of range
 * @param max - Maximum value of range
 * @param sampleSize - Number of samples to test (default: 1000)
 * @returns True if configuration meets 80% constraint, false otherwise
 */
export function validateDistribution(
    config: DistributionConfig,
    min: number,
    max: number,
    sampleSize: number = 1000
): { valid: boolean; successRate: number } {
    if (config.type === 'uniform') {
        return { valid: true, successRate: 1.0 };
    }

    let successCount = 0;

    for (let i = 0; i < sampleSize; i++) {
        const value = generateConstrainedInteger(min, max, config, 1); // Only 1 attempt for true test
        if (value >= min && value <= max) {
            successCount++;
        }
    }

    const successRate = successCount / sampleSize;
    return {
        valid: successRate >= 0.8,
        successRate: successRate
    };
}

// ============================================================================
// DEBUGGING UTILITIES
// ============================================================================

/**
 * Generates a histogram of distribution samples for debugging
 * @param config - Distribution configuration
 * @param min - Minimum value
 * @param max - Maximum value
 * @param sampleSize - Number of samples to generate
 * @param bucketCount - Number of histogram buckets
 * @returns Object with histogram data and statistics
 */
export function generateHistogram(
    config: DistributionConfig,
    min: number,
    max: number,
    sampleSize: number = 1000,
    bucketCount: number = 10
): {
    buckets: number[];
    labels: string[];
    mean: number;
    median: number;
    mode: number;
    inRangeCount: number;
    outOfRangeCount: number;
} {
    const samples: number[] = [];
    const buckets = new Array(bucketCount).fill(0);
    const bucketSize = (max - min) / bucketCount;
    const labels: string[] = [];

    // Generate labels
    for (let i = 0; i < bucketCount; i++) {
        const start = min + (i * bucketSize);
        const end = min + ((i + 1) * bucketSize);
        labels.push(`${Math.round(start)}-${Math.round(end)}`);
    }

    // Generate samples
    let inRangeCount = 0;
    let outOfRangeCount = 0;

    for (let i = 0; i < sampleSize; i++) {
        const value = generateConstrainedInteger(min, max, config, 1);
        samples.push(value);

        if (value >= min && value <= max) {
            inRangeCount++;
            const bucketIndex = Math.min(
                Math.floor((value - min) / bucketSize),
                bucketCount - 1
            );
            buckets[bucketIndex]++;
        } else {
            outOfRangeCount++;
        }
    }

    // Calculate statistics
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((sum, val) => sum + val, 0) / samples.length;
    const median = samples[Math.floor(samples.length / 2)];

    // Find mode
    const frequency: { [key: number]: number } = {};
    let maxFreq = 0;
    let mode = samples[0];
    for (const value of samples) {
        frequency[value] = (frequency[value] || 0) + 1;
        if (frequency[value] > maxFreq) {
            maxFreq = frequency[value];
            mode = value;
        }
    }

    return {
        buckets,
        labels,
        mean,
        median,
        mode,
        inRangeCount,
        outOfRangeCount
    };
}

/**
 * Prints distribution debug info to console
 * @param config - Distribution configuration
 * @param min - Minimum value
 * @param max - Maximum value
 */
export function debugDistribution(
    config: DistributionConfig,
    min: number,
    max: number
): void {
    console.log('=== DISTRIBUTION DEBUG ===');
    console.log('Type:', config.type);
    console.log('Center:', (config.center * 100).toFixed(1) + '%');
    console.log('Spread:', (config.spread * 100).toFixed(1) + '%');
    console.log('Range:', min, '-', max);

    // Generate histogram
    const histogram = generateHistogram(config, min, max, 1000, 10);

    console.log('\nHistogram (1000 samples):');
    for (let i = 0; i < histogram.buckets.length; i++) {
        const bar = 'ˆ'.repeat(Math.round(histogram.buckets[i] / 10));
        console.log(`${histogram.labels[i]}: ${bar} (${histogram.buckets[i]})`);
    }

    console.log('\nStatistics:');
    console.log('Mean:', histogram.mean.toFixed(2));
    console.log('Median:', histogram.median);
    console.log('Mode:', histogram.mode);
    console.log('In range:', histogram.inRangeCount, `(${(histogram.inRangeCount / 10).toFixed(1)}%)`);
    console.log('Out of range:', histogram.outOfRangeCount, `(${(histogram.outOfRangeCount / 10).toFixed(1)}%)`);

    // Validate 80% constraint
    const validation = validateDistribution(config, min, max, 1000);
    console.log('\n80% Constraint:', validation.valid ? ' PASS' : ' FAIL');
    console.log('Success rate:', (validation.successRate * 100).toFixed(1) + '%');
    console.log('=========================\n');
}