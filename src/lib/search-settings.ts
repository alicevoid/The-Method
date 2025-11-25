/**
 * Search Settings - Search Term Formatting & YouTube URL Generation
 *
 * REFACTORED RESPONSIBILITIES:
 * This module is now responsible for taking a search term object (selected by +page.svelte)
 * and formatting it into a complete YouTube search URL.
 *
 * NEW FUNCTIONS:
 *  - formatSearchTermToURL(): Takes a SearchPattern object and returns a formatted YouTube URL
 *  - generateSpecifierValue(): Fills in specifier templates (YYYY, XXXX, etc.) with actual values
 *  - meetsDateConstraints(): Checks if a pattern meets date constraints
 *  - Helper functions for date/time generation and constraint parsing
 *
 * WORKFLOW:
 *  1. +page.svelte selects a random SearchPattern from the active subset
 *  2. Pass that object to formatSearchTermToURL()
 *  3. This function generates the specifier, applies constraints, and formats the YouTube URL
 *  4. Returns the complete URL ready to open in a new tab
 */

// Import types from method-logic
import type { SearchPattern, Constraint } from './method-logic.js';

// ============================================================================
// NEW PUBLIC API: SEARCH TERM FORMATTING
// ============================================================================

/**
 * Format a search term object into a complete YouTube search URL
 *
 * NEW WORKFLOW:
 * 1. Pattern-match to return a search term with the specifier filled in
 * 2. Determine how to add date-tag (before:/after:)
 * 3. Always filter videos by upload date
 *
 * @param pattern - The search pattern object to format
 * @param specifier - The specific specifier to use from pattern.specifiers
 * @param formattedDate - The date from +page.svelte randomSpecDay()
 * @returns Complete YouTube search URL ready to open
 */
export function formatSearchTermToURL(
  pattern: SearchPattern,
  specifier: string,
  formattedDate: Date,
  dateOverride: boolean
): string {

  // Step 1: Pattern-match to generate the search term (name + filled specifier)
  let searchTerm = generateSearchTerm(pattern.name, specifier, pattern, formattedDate);

  // Step 1.5: Add Quotes around the entire Search Term to force exact match
  searchTerm = `"${searchTerm}"`;

  // Step 2: Determine the date filter
  const dateFilter = determineDateFilter(specifier, pattern, formattedDate, searchTerm, dateOverride);

  // Combine search term with date filter
  const fullSearchTerm = dateFilter ? `${searchTerm} ${dateFilter}` : searchTerm;

  // Step 3: Build YouTube search URL with upload date sort
  const params = new URLSearchParams({
    search_query: fullSearchTerm
  });

  // Always sort by upload date
  // Use upload date filter (this ensures we're filtering by upload date)
  params.append('sp', 'CAISAhAB'); // Upload date sort

  // Return the complete YouTube URL
  return `https://www.youtube.com/results?${params.toString()}`;
}

// ============================================================================
// HELPER FUNCTIONS: PATTERN MATCHING & SPECIFIER GENERATION
// ============================================================================

/**
 * Step 3: Generate a search term by pattern-matching the specifier template
 * Fills in placeholders like YYYY, MM, DD, XXXX, etc.
 *
 * @param name - The base search term name
 * @param specifier - The specifier template (e.g., "YYYY MM DD", "XXXX")
 * @param pattern - The SearchPattern object for constraints
 * @param formattedDate - The date to use when filling in date placeholders
 * @returns Complete search term (name + filled specifier)
 */
function generateSearchTerm(
  name: string,
  specifier: string,
  pattern: SearchPattern,
  formattedDate: Date
): string {
  // If no specifier, just return the name
  if (!specifier || specifier === '') {
    return name;
  }

  // Generate the specifier value by filling in template placeholders
  const specifierValue = fillSpecifierTemplate(specifier, pattern, formattedDate);

  // Combine name + specifier
  return specifierValue ? `${name}${specifierValue}` : name;
}

/**
 * Fill in template placeholders in a specifier
 * Handles templates like:
 * - YYYY MM DD -> 2024 03 15
 * - XXXX -> 1234
 * - HHMMSS -> 143059
 */
export function fillSpecifierTemplate(
  specifier: string,
  pattern: SearchPattern,
  formattedDate: Date
): string {
  if (!specifier || specifier === '') return '';

  let result = specifier;

  // Replace date/time placeholders
  // YYYY - Year (4 digits)
  if (result.includes('YYYY')) {
    let year: number;
    year = formattedDate.getFullYear();
    result = result.replace(/YYYY/g, year.toString().padStart(4, '0'));
  }

  // Month - Month (January - December)
  if (result.includes('Month')) {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthIndex = formattedDate.getMonth();
    result = result.replace(/Month/g, monthNames[monthIndex]);
  }

  // Mon - Short Month (Jan - Dec)
  if (result.includes('Mon')) {
    const shortMonthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const monthIndex = formattedDate.getMonth();
    result = result.replace(/Mon/g, shortMonthNames[monthIndex]);
  }

  // MM - Month (01-12)
  if (result.includes('MM')) {
    const month = formattedDate.getMonth() + 1; // Months are 0-indexed
    result = result.replace(/MM/g, month.toString().padStart(2, '0'));
  }

  // DD - Day (01-31)
  if (result.includes('DD')) {
    const day = formattedDate.getDate().toString().padStart(2, '0');
    result = result.replace(/DD/g, day);
  }

  // HH - Hours (00-23)
  if (result.includes('HH')) {
    const hours = formattedDate.getHours().toString().padStart(2, '0');
    result = result.replace(/HH/g, hours);
  }

  // mm - Minutes (00-59)
  if (result.includes('mm')) {
    const minutes = formattedDate.getMinutes().toString().padStart(2, '0');
    result = result.replace(/mm/g, minutes);
  }

  // SS - Seconds (00-59)
  if (result.includes('SS')) {
    const seconds = formattedDate.getSeconds().toString().padStart(2, '0');
    result = result.replace(/SS/g, seconds);
  }

  // X - Any amount of X's will be replaced with that many random digits (consider constraints)
  if (result.includes('X')) {
    // Determine how many separate words of X's there are 
    const xMatches = result.match(/X+/g);

    if (xMatches) {
      // Process each X field separately
      for (const xGroup of xMatches) {
        const xCount = xGroup.length;

        // Determine if any constraints apply
        let min = 0;
        let max = Math.pow(10, xCount) - 1; // Default max based on X count (e.g., X=9, XX=99, XXX=999)
        let constraintType: 'number' | 'letter' | 'hex' = 'number'; // Default to number

        // Check for constraints that apply to this X field
        for (const constraint of pattern.constraints) {

          // For Number Ranges
          if (constraint.type === 'range') {
            const range = parseRangeConstraint(String(constraint.value));
            if (range) {
              console.log('Applying range constraint:', range);
              min = range.min;
              max = range.max;
              constraintType = 'number';
            }

          // For Letter Ranges
          } else if (constraint.type === 'letter-range') {
            const range = parseRangeConstraint(String(constraint.value));
            if (range) {
              console.log('Applying letter-range constraint:', range);
              min = range.min;
              max = range.max;
              constraintType = 'letter';
            }
          
          // For Hex Ranges
          } else if (constraint.type === 'hex-range') {
            const range = parseRangeConstraint(String(constraint.value));
            if (range) {
              console.log('Applying hex-range constraint:', range);
              min = range.min;
              max = range.max;
              constraintType = 'hex';
            }
          }
        }

        // Generate a value that goes between the given constraints
        let replacement: string;

        if (constraintType === 'letter') {
          const randomNum = getRandomInt(min, max);
          replacement = String.fromCharCode(randomNum);
        } else if (constraintType === 'hex') {
          const randomNum = getRandomInt(min, max);
          replacement = randomNum.toString(16).toUpperCase();
        } else {
          // Default: number
          const randomNum = getRandomInt(min, max);
          replacement = randomNum.toString();
        }

        // Step 5: Set that to the result but keep the formatting the same (pad to match X count)
        replacement = replacement.padStart(xCount, '0');
        result = result.replace(xGroup, replacement);
      }
    }
  }

  return result;
}

// ============================================================================
// HELPER FUNCTIONS: DATE FILTER DETERMINATION
// ============================================================================

/**
 * Step 4: Determine how to handle adding a date-tag for before: or after: a certain date
 *
 * @param specifier - The specifier template (e.g., "YYYY MM DD", "XXXX")
 * @param pattern - The SearchPattern object
 * @param formattedDate - The date from +page.svelte randomSpecDay()
 * @param searchTerm - The generated search term (name + filled specifier) for extracting date
 * @returns Date filter string (e.g., "after:2020-01-15" or "before:2024-12-31" or empty string)
 */
function determineDateFilter(
  specifier: string,
  pattern: SearchPattern,
  formattedDate: Date,
  searchTerm: string,
  dateOverride: boolean
): string {
  // If the specifier contains YYYY (year placeholder), make it after: that year
  const hasYearPlaceholder = /YYYY/.test(specifier);

  // If the override date is used, we just do before: that date and end it there
  if (dateOverride) {
    console.log('Applying date filter for override pattern');
    const year = formattedDate.getFullYear();
    const month = String(formattedDate.getMonth() + 1).padStart(2, '0');
    const day = String(formattedDate.getDate()).padStart(2, '0');
    return `before:${year}-${month}-${day}`;
  }

  if (hasYearPlaceholder) {
    // Extract the actual year (4 digits) from the filled searchTerm
    const yearRegex = /\b(\d{4})\b/;
    const match = searchTerm.match(yearRegex);

    if (match) {
      const year = match[1];
      const month = formattedDate.getMonth() + 1; // Months are 0-indexed
      const day = formattedDate.getDate();
      console.log('Applying date filter from specifier year:', year);
      // Use January 1st of that year for the after: filter
      return `after:${year}-${month}-${day}`;
    }
  }

  // 4b. If the search is tagged as 'old', make it before formattedDate
  if (pattern.age === 'old') {
    console.log('Applying date filter for old pattern');
    const year = formattedDate.getFullYear();
    const month = String(formattedDate.getMonth() + 1).padStart(2, '0');
    const day = String(formattedDate.getDate()).padStart(2, '0');
    return `before:${year}-${month}-${day}`;
  }

  // 4c. If the search is tagged as 'new', don't add any date tag
  if (pattern.age === 'new') {
    console.log('No date filter applied for new pattern');
    return '';
  }

  // Default: no date filter
  return '';
}

/**
 * Parse a range constraint value
 * Format: "min-max" like "1000-9999" or "1-12"
 */
function parseRangeConstraint(value: string): { min: number; max: number } | null {
  const parts = value.split('-');
  if (parts.length !== 2) return null;

  const min = parseInt(parts[0], 10);
  const max = parseInt(parts[1], 10);

  if (isNaN(min) || isNaN(max)) return null;

  return { min, max };
}

/**
 * Generate a random integer between min and max (inclusive)
 */
function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomLetter(min: number, max: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letterArray = letters.split('');
  const randomIndex = Math.floor(Math.random() * (max - min + 1)) + min;
  return letterArray[randomIndex % letterArray.length];
}

function getRandomHex(min: number, max: number): string {
  const hexChars = '0123456789ABCDEF';
  const hexArray = hexChars.split('');
  const randomIndex = Math.floor(Math.random() * (max - min + 1)) + min;
  return hexArray[randomIndex % hexArray.length];
}


