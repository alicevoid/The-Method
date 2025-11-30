<script lang="ts">
    // ============================================================================
    // REFACTORED ARCHITECTURE OVERVIEW
    // ============================================================================
    // This file manages the UI state and user interactions for the video search randomizer.
    //
    // NEW DATA FLOW:
    // 1. +page.svelte loads ALL search term objects from JSON as a single unified list
    // 2. User filter selections update "active flags" for each search term
    // 3. When "Find Videos" is clicked:
    //    a. Randomly select one item from the active subset
    //    b. Pass it to search-settings.ts for formatting (specifier generation, date handling)
    //    c. Open the formatted YouTube URL
    //
    // RESPONSIBILITIES BY FILE:
    // - +page.svelte: Holds the full list, manages active flags, random selection
    // - method-logic.ts: Read/save JSON objects only
    // - search-settings.ts: Parse & format search terms, handle constraints, generate URLs
    //
    // ============================================================================
    // IMPORTS
    // ============================================================================
    import { base } from '$app/paths';
    import { onMount } from 'svelte';
    import { loadAllSearchTerms, formatSearchTermToURL, fillSpecifierTemplate, type SearchPattern } from '$lib';
    import { generateConstrainedDate, generateConstrainedInteger, debugDistribution } from '$lib/randomness';
    import DistributionGraph from '$lib/components/DistributionGraph.svelte';

    // ============================================================================
    // DATA STRUCTURE: FULL LIST OF SEARCH TERM OBJECTS
    // ============================================================================

    // This is the single source of truth for all search terms
    let allSearchTerms: SearchPattern[] = loadAllSearchTerms();

    // ============================================================================
    // DERIVED LISTS FOR UI DROPDOWNS
    // ============================================================================


    // Derive all unique genres from the search terms
    // Sort alphabetically, but put NSFW at the front if it exists
    let allGenres: string[] = [];
    $: {
        const genres = Array.from(new Set(allSearchTerms.map(term => term.genre)))
            .filter(genre => genre !== '') // Remove empty genres
            .sort(); // Sort alphabetically

        // Move NSFW to the front if it exists
        if (genres.includes('NSFW')) {
            allGenres = ['NSFW', ...genres.filter(genre => genre !== 'NSFW')];
        } else {
            allGenres = genres;
        }
    }

    // Derive all unique name+specifier combinations from the search terms
    // Each unique combination will be a separate item in the dropdown
    interface NameSpecifierItem {
        name: string;
        specifier: string;
        displayKey: string; // Unique key for this combination
        showSpecifier: boolean; // Only show specifier if multiple items share the same name
    }

    // Collision Handling for Overlapping Names with Different Specifiers
    // availableNames represents terms that are "pre-approved for random selection"
    // It is controlled by selectedGenres - only terms from selected genres appear here
    let availableNames: NameSpecifierItem[] = [];
    $: {
        // Filter by selected genres - this controls what appears in the search terms list
        const filtered = allSearchTerms.filter(term => selectedGenres.has(term.genre));

        // Expand patterns with multiple specifiers into separate items
        const uniqueCombos = new Map<string, NameSpecifierItem>();

        for (const term of filtered) {
            // Each pattern can have multiple specifiers
            for (const specifier of term.specifiers) {
                const key = `${term.name}|||${specifier}`; // Use ||| as separator to avoid collisions
                if (!uniqueCombos.has(key)) {
                    uniqueCombos.set(key, {
                        name: term.name,
                        specifier: specifier,
                        displayKey: key,
                        showSpecifier: false // Will be updated below
                    });
                }
            }
        }

        const items = Array.from(uniqueCombos.values());

        // Count how many items have each name
        const nameCounts = new Map<string, number>();
        for (const item of items) {
            nameCounts.set(item.name, (nameCounts.get(item.name) || 0) + 1);
        }

        // Mark items that need to show specifiers (when multiple items share a name)
        for (const item of items) {
            item.showSpecifier = (nameCounts.get(item.name) || 0) > 1;
        }

        // Sort by name, then by specifier
        availableNames = items.sort((a, b) => {
            if (a.name !== b.name) return a.name.localeCompare(b.name);
            return a.specifier.localeCompare(b.specifier);
        });
    }

    // ============================================================================
    // STATE: ADVANCED SETTINGS
    // ============================================================================

    let showAdvancedSettings: boolean = false;
    let activeTab: 'general' | 'filters' | 'rng' | 'history' | 'custom' | 'lookup' = 'general';

    // ============================================================================
    // STATE: RANDOMNESS MODE (for Randomness tab)
    // ============================================================================

    // Types for distribution configuration
    type DistributionType = 'uniform' | 'bell' | 'z-curve' | 't-curve';

    interface DistributionConfig {
        type: DistributionType;
        center: number;      // 0-1 (percentage of range)
        spread: number;      // 0-1 (relative spread)
        degreesOfFreedom?: number;  // For t-curve (1-30)
    }

    // Master randomness toggle
    let enableRandomnessMode = false;

    // Individual graph enable toggles
    let enableIntegerGraph = true;
    let enableDateGraph = true;

    // Integer distribution config
    let integerDistConfig: DistributionConfig = {
        type: 'bell',
        center: 0.5,     // Middle of range (50%)
        spread: 0.25,    // Default spread (25%)
        degreesOfFreedom: 5
    };

    // Date distribution config
    let dateDistConfig: DistributionConfig = {
        type: 'bell',
        center: 0.5,     // Middle of date range (50%)
        spread: 0.2,     // Default spread (20%)
        degreesOfFreedom: 5
    };

    // Date range for date distribution graph
    const distributionStartDate = new Date('2005-12-31');
    const distributionEndDate = new Date();

    // Refresh keys for sample previews (increment to regenerate samples)
    let integerSampleRefreshKey = 0;
    let dateSampleRefreshKey = 0;

    // Drag state for graph interaction
    let isDragging = false;
    let dragGraphType: 'integer' | 'date' | null = null;
    let lastMouseX = 0;
    let lastMouseY = 0;

    // ============================================================================
    // STATE: SEARCH HISTORY (for Search History tab)
    // ============================================================================

    interface SearchHistoryEntry {
        name: string;
        specifier: string;
        url: string;
        timestamp: Date;
        dateModifier?: string; // e.g., "before:20241125" or "after:20050423"
    }

    let searchHistory: SearchHistoryEntry[] = [];
    let enablePersistentHistory: boolean = false;
    let showDisableWarning: boolean = false; // For custom modal
    let pendingCheckboxElement: HTMLInputElement | null = null; // Store checkbox reference for revert

    // ============================================================================
    // COOKIE HELPER FUNCTIONS
    // ============================================================================
    function setCookie(name: string, value: string, days: number = 365) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        const expires = `expires=${date.toUTCString()}`;
        document.cookie = `${name}=${value};${expires};path=/`;
    }

    function getCookie(name: string): string | null {
        const nameEQ = `${name}=`;
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    function deleteCookie(name: string) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
    }

    // ============================================================================
    // LIFECYCLE: LOAD SEARCH HISTORY AND COOKIE PREFERENCE
    // ============================================================================
    onMount(() => {
        // Check if user previously enabled persistent history
        const persistentPref = getCookie('enablePersistentHistory');
        if (persistentPref === 'true') {
            enablePersistentHistory = true;
            // Load history from cookie
            const storedHistory = getCookie('searchHistory');
            if (storedHistory) {
                try {
                    const parsed = JSON.parse(decodeURIComponent(storedHistory));
                    searchHistory = parsed.map((entry: any) => ({
                        ...entry,
                        timestamp: new Date(entry.timestamp)
                    }));
                } catch (e) {
                    console.error('Failed to load search history from cookie:', e);
                }
            }
        }

        // Add global mouse event listeners for dragging
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        console.log('Mouse event listeners attached');

        // Cleanup on unmount
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            if (integerChart) integerChart.destroy();
            if (dateChart) dateChart.destroy();
            console.log('Cleanup: event listeners and charts removed');
        };
    });

    // ============================================================================
    // REACTIVE: INITIALIZE CHARTS WHEN RANDOMNESS TAB BECOMES ACTIVE
    // ============================================================================
    // Canvas-based graphs will handle their own updates reactively

    // ============================================================================
    // REACTIVE: SAVE SEARCH HISTORY TO COOKIES (if enabled)
    // ============================================================================
    $: if (typeof document !== 'undefined' && enablePersistentHistory && searchHistory.length > 0) {
        // Save to cookie when persistent history is enabled
        const historyJSON = JSON.stringify(searchHistory);
        setCookie('searchHistory', encodeURIComponent(historyJSON), 365);
    }

    // ============================================================================
    // FUNCTION: CLEAR SEARCH HISTORY
    // ============================================================================
    function clearSearchHistory() {
        searchHistory = [];
        deleteCookie('searchHistory');
    }

    // ============================================================================
    // FUNCTION: TOGGLE PERSISTENT HISTORY
    // ============================================================================
    function togglePersistentHistory(event: Event) {
        console.log('🔘 Cookie checkbox clicked!');

        const checkbox = event.target as HTMLInputElement;
        const newValue = checkbox.checked;

        console.log('📊 Checkbox state:', {
            'Current enablePersistentHistory': enablePersistentHistory,
            'Checkbox new value (checked)': newValue,
            'Action': newValue ? 'Attempting to ENABLE' : 'Attempting to DISABLE'
        });

        if (!newValue && enablePersistentHistory) {
            // User is trying to disable - show custom warning modal
            console.log('⚠️ User is trying to DISABLE persistent history - showing custom warning');
            pendingCheckboxElement = checkbox;
            showDisableWarning = true;
        } else if (newValue && !enablePersistentHistory) {
            // User is enabling - save preference
            console.log('✅ User is ENABLING persistent history');
            enablePersistentHistory = true;
            setCookie('enablePersistentHistory', 'true', 365);
            console.log('💾 Cookie preference saved, enablePersistentHistory = true');
        } else {
            console.log('⚡ No action needed - states already match');
        }

        console.log('📌 Final state: enablePersistentHistory =', enablePersistentHistory);
    }

    // ============================================================================
    // FUNCTION: CONFIRM DISABLE PERSISTENT HISTORY
    // ============================================================================
    function confirmDisablePersistentHistory() {
        console.log('✅ User CONFIRMED disabling - clearing history and cookies');
        enablePersistentHistory = false;
        // Clear all history and cookies
        searchHistory = [];
        deleteCookie('searchHistory');
        deleteCookie('enablePersistentHistory');
        console.log('🗑️ History cleared, cookies deleted, enablePersistentHistory = false');
        showDisableWarning = false;
        pendingCheckboxElement = null;
    }

    // ============================================================================
    // FUNCTION: CANCEL DISABLE PERSISTENT HISTORY
    // ============================================================================
    function cancelDisablePersistentHistory() {
        console.log('❌ User CANCELLED disabling - reverting checkbox to checked');
        if (pendingCheckboxElement) {
            pendingCheckboxElement.checked = true;
        }
        console.log('🔄 Checkbox reverted, enablePersistentHistory remains true');
        showDisableWarning = false;
        pendingCheckboxElement = null;
    }

    // ============================================================================
    // STATE: TERM LOOKUP TAB
    // ============================================================================

    let termLookupSearchQuery: string = '';
    let termLookupGenreFilter: string = 'all';
    let termLookupAgeFilter: 'any' | 'new' | 'old' = 'any';
    let termLookupSortOrder: 'asc' | 'desc' = 'asc';
    let selectedLookupTerm: string | null = null; // Track which term detail is expanded (displayKey)

    // ============================================================================
    // REACTIVE: TERM LOOKUP FILTERED LIST
    // ============================================================================
    // Create expanded list of all name+specifier combinations for lookup
    // This shows all terms (not filtered by selected genres like availableNames)

    let lookupTermsList: NameSpecifierItem[] = [];
    $: {
        // Start with all search terms
        const allTerms = allSearchTerms;

        // Expand patterns with multiple specifiers into separate items
        const uniqueCombos = new Map<string, NameSpecifierItem & { genre: string, age: string }>();

        for (const term of allTerms) {
            for (const specifier of term.specifiers) {
                const key = `${term.name}|||${specifier}`;
                if (!uniqueCombos.has(key)) {
                    uniqueCombos.set(key, {
                        name: term.name,
                        specifier: specifier,
                        displayKey: key,
                        showSpecifier: false,
                        genre: term.genre,
                        age: term.age
                    });
                }
            }
        }

        let items = Array.from(uniqueCombos.values());

        // Apply filters
        items = items.filter(item => {
            // Search query filter
            if (termLookupSearchQuery) {
                const query = termLookupSearchQuery.toLowerCase();
                const matchesName = item.name.toLowerCase().includes(query);
                const matchesSpecifier = item.specifier.toLowerCase().includes(query);
                if (!matchesName && !matchesSpecifier) {
                    return false;
                }
            }

            // Genre filter
            if (termLookupGenreFilter !== 'all' && item.genre !== termLookupGenreFilter) {
                return false;
            }

            // Age filter
            if (termLookupAgeFilter !== 'any') {
                if (item.age !== '' && item.age !== termLookupAgeFilter) {
                    return false;
                }
            }

            return true;
        });

        // Count how many items have each name for showSpecifier logic
        const nameCounts = new Map<string, number>();
        for (const item of items) {
            nameCounts.set(item.name, (nameCounts.get(item.name) || 0) + 1);
        }

        // Mark items that need to show specifiers
        for (const item of items) {
            item.showSpecifier = (nameCounts.get(item.name) || 0) > 1;
        }

        // Sort
        items.sort((a, b) => {
            const comparison = a.name.localeCompare(b.name);
            return termLookupSortOrder === 'asc' ? comparison : -comparison;
        });

        lookupTermsList = items;
    }

    // ============================================================================
    // STATE: DATE FILTER
    // ============================================================================

    // Default to today's date
    let customDate: string = (() => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    })();

    let enableDateOverride: boolean = false;
    let dateFilterType: 'before' | 'after' | 'exact' = 'before';

    // ============================================================================
    // FUNCTION: VALIDATE AND CORRECT CUSTOM DATE
    // ============================================================================
    function validateCustomDate() {
        if (!customDate) return;

        const minDate = new Date('2005-04-23');
        const fallbackDate = '2015-12-27'; // December 27, 2015
        const selectedDate = new Date(customDate);

        console.log('📅 Date validation:', {
            'Selected date': customDate,
            'Parsed date': selectedDate,
            'Min allowed': minDate
        });

        if (selectedDate < minDate) {
            console.log('⚠️ Date is before minimum! Auto-correcting to December 27, 2015');
            customDate = fallbackDate;
            console.log('✅ Date corrected to:', customDate);
        } else {
            console.log('✅ Date is valid');
        }
    }
    let enableUserTerms: boolean = false;
    let editCustomTerms: boolean = false;

    // ============================================================================
    // REACTIVE: AUTO-LOAD/UNLOAD CUSTOM TERMS
    // ============================================================================
    // Automatically load or remove custom terms when checkbox is toggled
    $: {
        if (enableUserTerms) {
            loadCustomTermsIntoPool();
        } else {
            removeCustomTermsFromPool();
        }
    }

    // ============================================================================
    // STATE: CUSTOM SEARCH TERM BUILDER
    // ============================================================================
    let customName: string = '';
    let customSpecifiersList: string[] = ['']; // Array of individual specifiers
    let customGenre: string = 'Custom'; // Default to "Custom"
    let customAge: '' | 'new' | 'old' = '';
    let customConstraintType: string = 'none'; // 'none', 'before', 'after', 'exact'
    let customConstraintDate: string = '';
    let showMoreInfo: boolean = false; // Toggle for optional fields
    let selectedTermIndex: number | null = null; // Track which term is loaded for editing
    let savedCustomTerms: SearchPattern[] = []; // Reactive list of saved custom terms

    // ============================================================================
    // STATE: IMPORT/EXPORT MANAGER
    // ============================================================================
    let manageCustomTerms: boolean = false; // Toggle for import/export form
    let selectedFile: File | null = null; // Store selected file
    let importStats: { success: number; failed: number } | null = null; // Track import results

    // ============================================================================
    // STATE: AGE FILTER
    // ============================================================================
    let selectedAge: 'any' | 'new' | 'old' = 'any';

    // ============================================================================
    // STATE: GENRE SELECTION
    // ============================================================================
    // Initialize with all genres selected except NSFW

    // Variables to hold selected genres
    let selectedGenres: Set<string> = new Set();
    let selectAllGenres: boolean = false;
    let genreDropdownOpen: boolean = false;
    let genresInitialized: boolean = false;
    let genreSearchBuffer: string = '';
    let genreSearchTimeout: number | null = null;
    let genreDropdownElement: HTMLDivElement;

    // Initialize selectedGenres after allGenres is computed (only once)
    $: if (allGenres.length > 0 && !genresInitialized) {
        selectedGenres = new Set(allGenres.filter(genre => genre !== 'NSFW'));
        genresInitialized = true;
    }

    // Sync selectAllGenres checkbox with actual selection state
    $: selectAllGenres = allGenres.length > 0 && selectedGenres.size === allGenres.length;

    // Auto-focus genre dropdown when it opens
    $: if (genreDropdownOpen && genreDropdownElement) {
        setTimeout(() => genreDropdownElement.focus(), 0);
    }
    
    // ============================================================================
    // STATE: NAME/SEARCH TERM SELECTION
    // ============================================================================
    // selectedNames contains the displayKeys that are actually enabled for random selection
    // When a genre is selected, all its terms are added to selectedNames
    // When a genre is deselected, all its terms are removed from selectedNames
    // Users can individually toggle terms on/off within the available list

    let selectedNames: Set<string> = new Set();
    let selectAllNames: boolean = true;
    let nameDropdownOpen: boolean = false;
    let namesInitialized: boolean = false;
    let nameSearchBuffer: string = '';
    let nameSearchTimeout: number | null = null;
    let nameDropdownElement: HTMLDivElement;

    // Track the previous set of available names to detect what changed
    let previousAvailable: Set<string> = new Set();

    // When availableNames changes (due to genre selection), update selectedNames
    // New terms from newly selected genres should be added to selectedNames
    // Terms from deselected genres should be removed from selectedNames
    $: {
        // Get the set of currently available displayKeys
        const currentAvailable = new Set(availableNames.map(item => item.displayKey));

        // If this is the first initialization, select all available terms
        if (!namesInitialized && availableNames.length > 0) {
            selectedNames = new Set(currentAvailable);
            namesInitialized = true;
            previousAvailable = currentAvailable;
        } else if (namesInitialized) {
            // For subsequent updates:
            // 1. Remove terms that are no longer available (genre was deselected)
            const newSelected = new Set<string>();
            for (const key of selectedNames) {
                if (currentAvailable.has(key)) {
                    newSelected.add(key);
                }
            }

            // 2. Add newly available terms (genre was selected)
            // Only add terms that are new (weren't in previousAvailable)
            for (const key of currentAvailable) {
                if (!previousAvailable.has(key)) {
                    // This is a newly added term from a newly selected genre
                    newSelected.add(key);
                }
            }

            selectedNames = newSelected;
            previousAvailable = currentAvailable;
        }
    }

    // Sync selectAllNames checkbox with actual selection state
    $: selectAllNames = availableNames.length > 0 && selectedNames.size === availableNames.length;

    // Auto-focus name dropdown when it opens
    $: if (nameDropdownOpen && nameDropdownElement) {
        setTimeout(() => nameDropdownElement.focus(), 0);
    }

    // ============================================================================
    // REACTIVE: ACTIVE SEARCH TERM FILTERING
    // ============================================================================
    // Create a filtered list of search terms based on all active filters
    // This will be used for random selection when "Find Videos" is clicked
    // Note: We only filter by selectedNames and age now - genres control what's in selectedNames

    let activeSearchTerms: SearchPattern[] = [];
    $: {
        activeSearchTerms = allSearchTerms.filter(pattern => {
            // Filter by age (new/old/any)
            if (selectedAge !== 'any') {
                // If pattern has a specific age, it must match the selected age
                if (pattern.age !== '' && pattern.age !== selectedAge) {
                    return false;
                }
                // If pattern has no age specified (''), include it as well
                if (pattern.age === '') {
                    return true;
                }
            }

            // Filter by name+specifier combination (selectedNames is the only source of truth)
            // Check if any of the pattern's specifiers match a selected name
            if (selectedNames.size > 0) {
                const hasMatchingSpecifier = pattern.specifiers.some((specifier: string) => {
                    const key = `${pattern.name}|||${specifier}`;
                    return selectedNames.has(key);
                });
                if (!hasMatchingSpecifier) {
                    return false;
                }
            }

            return true;
        });
    }

    // Count of active/total search terms for display
    $: activeCount = activeSearchTerms.length;
    $: totalCount = allSearchTerms.length;

    // ============================================================================
    // FUNCTIONS: GENRE SELECTION
    // ============================================================================

    // Lets you do that cool thing where if you start typing a word it jumps to that item
    function handleGenreKeydown(event: KeyboardEvent) {
        // Only handle letter/number keys
        if (event.key.length === 1 && /[a-zA-Z0-9]/.test(event.key)) {
            // Clear previous timeout
            if (genreSearchTimeout !== null) {
                clearTimeout(genreSearchTimeout);
            }

            // Add to search buffer
            genreSearchBuffer += event.key.toLowerCase();

            // Find matching genre
            const match = allGenres.find(genre =>
                genre.toLowerCase().startsWith(genreSearchBuffer)
            );

            if (match) {
                // Scroll to the matching element
                const element = document.getElementById(`genre-${match}`);
                if (element) {
                    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }

            // Clear buffer after 1 second of no typing
            genreSearchTimeout = window.setTimeout(() => {
                genreSearchBuffer = '';
            }, 1000);
        }
    }

    // Toggle individual genre selection
    function toggleGenre(genre: string) {
        if (selectedGenres.has(genre)) {
            selectedGenres.delete(genre);
        } else {
            selectedGenres.add(genre);
        }
        selectedGenres = selectedGenres; // Trigger reactivity
    }

    // Toggle select/deselect all genres
    function toggleSelectAll() {
        if (selectedGenres.size === allGenres.length) {
            // Currently all selected, so deselect all
            selectedGenres = new Set();
        } else {
            // Not all selected, so select all
            selectedGenres = new Set(allGenres);
        }
    }

    // ============================================================================
    // FUNCTIONS: NAME SELECTION
    // ============================================================================

    // Lets you do that cool thing where if you start typing a word it jumps to that item
    function handleNameKeydown(event: KeyboardEvent) {
        // Only handle letter/number keys
        if (event.key.length === 1 && /[a-zA-Z0-9]/.test(event.key)) {
            // Clear previous timeout
            if (nameSearchTimeout !== null) {
                clearTimeout(nameSearchTimeout);
            }

            // Add to search buffer
            nameSearchBuffer += event.key.toLowerCase();

            // Find matching name
            const match = availableNames.find(item =>
                item.name.toLowerCase().startsWith(nameSearchBuffer)
            );

            if (match) {
                // Scroll to the matching element
                const element = document.getElementById(`name-${match.displayKey}`);
                if (element) {
                    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }

            // Clear buffer after 1 second of no typing
            nameSearchTimeout = window.setTimeout(() => {
                nameSearchBuffer = '';
            }, 1000);
        }
    }

    // Toggle individual name+specifier selection
    // This directly adds/removes terms from the selectedNames set
    function toggleName(displayKey: string) {
        if (selectedNames.has(displayKey)) {
            // User is deselecting - remove from selected
            selectedNames.delete(displayKey);
        } else {
            // User is selecting - add to selected
            selectedNames.add(displayKey);
        }
        selectedNames = selectedNames; // Trigger reactivity
    }

    // Toggle select/deselect all names
    function toggleSelectAllNames() {
        if (selectedNames.size === availableNames.length) {
            // Currently all selected, so deselect all
            selectedNames = new Set();
        } else {
            // Not all selected, so select all
            selectedNames = new Set(availableNames.map(item => item.displayKey));
        }
    }

    // ============================================================================
    // FUNCTIONS: AGE FILTER
    // ============================================================================

    // Handle age filter changes
    function handleAgeChange(event: Event) {
        const target = event.target as HTMLSelectElement;
        selectedAge = target.value as 'any' | 'new' | 'old';
    }

    // ============================================================================
    // FUNCTIONS: RANDOM SEARCH TERM SELECTION
    // ============================================================================
    
    // Randomly select one search term from the active filtered list
    // Returns the pattern, specifier, and other relevant data
    function getRandomActiveSearchTerm(): { pattern: SearchPattern; specifier: string;} | null {
        if (activeSearchTerms.length === 0) {
            return null;
        }

        // Pick a random pattern from the active list
        const randomPattern = activeSearchTerms[Math.floor(Math.random() * activeSearchTerms.length)];

        // Filter the pattern's specifiers to only those that are selected
        const validSpecifiers = randomPattern.specifiers.filter((spec: string) => {
            const key = `${randomPattern.name}|||${spec}`;
            return selectedNames.has(key);
        });

        // Pick a random specifier from the valid ones
        const randomSpecifier = validSpecifiers.length > 0
            ? validSpecifiers[Math.floor(Math.random() * validSpecifiers.length)]
            : randomPattern.specifiers[0];

        // Return the entire object
        return {
            pattern: randomPattern,
            specifier: randomSpecifier,
        };
    }

    // ============================================================================
    // FUNCTIONS: RANDOM SPECIFIER DAY GENERATION
    // ============================================================================
    
    
    // Picks a random day if you dont override the date
    function randomSpecDay(pattern: SearchPattern): Date {
        const today = new Date();

        // Handle exact date constraint
        if (pattern.dateExact) {
            return new Date(pattern.dateExact);
        }

        // Determine date range based on constraints and age filter
        let startDate: Date;
        let endDate: Date = today;

        if (pattern.dateBefore) {
            endDate = new Date(pattern.dateBefore);
            startDate = new Date('2005-12-31'); // YouTube start date
        } else if (pattern.dateAfter) {
            startDate = new Date(pattern.dateAfter);
            endDate = today;
        } else {
            // Determine range based on age filter
            if (selectedAge === 'any') {
                if (pattern.age === 'old') {
                    // Last 10 years for old content
                    startDate = new Date(today);
                    startDate.setDate(startDate.getDate() - 3650);
                } else if (pattern.age === 'new') {
                    // Last year for new content
                    startDate = new Date(today);
                    startDate.setDate(startDate.getDate() - 365);
                } else {
                    // Default: YouTube start to today
                    startDate = new Date('2005-12-31');
                }
            } else if (selectedAge === 'old') {
                startDate = new Date(today);
                startDate.setDate(startDate.getDate() - 3650);
            } else if (selectedAge === 'new') {
                startDate = new Date(today);
                startDate.setDate(startDate.getDate() - 365);
            } else {
                startDate = new Date('2005-12-31');
            }
        }

        // Use randomness distribution if enabled
        if (enableRandomnessMode && enableDateGraph) {
            return generateConstrainedDate(startDate, endDate, dateDistConfig);
        }

        // Fall back to uniform random
        const diffTime = endDate.getTime() - startDate.getTime();
        const randomTime = startDate.getTime() + Math.random() * diffTime;
        return new Date(randomTime);
    }

    // ============================================================================
    // FUNCTIONS: CHART INITIALIZATION
    // ============================================================================

    // Charts are now handled by DistributionGraph components

    // ============================================================================
    // FUNCTIONS: GRAPH INTERACTION HANDLERS
    // ============================================================================

    function handleMouseDown(e: MouseEvent, graphType: 'integer' | 'date') {
        isDragging = true;
        dragGraphType = graphType;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }

    function handleMouseMove(e: MouseEvent) {
        if (!isDragging || !dragGraphType) return;

        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;

        if (dragGraphType === 'integer') {
            integerDistConfig.center += deltaX * 0.001;
            integerDistConfig.center = Math.max(0, Math.min(1, integerDistConfig.center));
            integerDistConfig.spread -= deltaY * 0.001;
            integerDistConfig.spread = Math.max(0.05, Math.min(0.5, integerDistConfig.spread));
            integerDistConfig = { ...integerDistConfig };
        } else if (dragGraphType === 'date') {
            dateDistConfig.center += deltaX * 0.001;
            dateDistConfig.center = Math.max(0, Math.min(1, dateDistConfig.center));
            dateDistConfig.spread -= deltaY * 0.001;
            dateDistConfig.spread = Math.max(0.05, Math.min(0.5, dateDistConfig.spread));
            dateDistConfig = { ...dateDistConfig };
        }

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }

    function handleMouseUp() {
        if (isDragging) {
            isDragging = false;
            dragGraphType = null;
        }
    }

    // ============================================================================
    // FUNCTIONS: MAIN BUTTON HANDLER
    // ============================================================================

    // Handle "Find Videos" button click
    function handleFindVideos() {
        // Get a random search term from the active filtered list
        const result = getRandomActiveSearchTerm();

        if (!result) {
            console.warn('No active search terms available');
            alert('No search terms match your current filters. Please adjust your selections.');
            return;
        }

        // Pick a date: use override date if enabled, otherwise pick random date
        let formattedDate: Date;
        if (enableDateOverride && customDate) {
            formattedDate = new Date(customDate);
            console.log('Using override date:', formattedDate);
        } else {
            formattedDate = randomSpecDay(result.pattern);
            console.log('Using random date:', formattedDate);
        }

        console.log('Selected pattern:', result.pattern);
        console.log('Selected specifier:', result.specifier);
        console.log('Formatted date:', formattedDate);
        console.log('Active search terms count:', activeCount);

        // Format the search term into a YouTube URL
        const integerConfig = (enableRandomnessMode && enableIntegerGraph) ? integerDistConfig : undefined;
        const formattedURL = formatSearchTermToURL(result.pattern, result.specifier, formattedDate, enableDateOverride, integerConfig);

        console.log('Opening YouTube search:', formattedURL);

        // Generate the filled specifier value (e.g., "XXXX" -> "1234")
        const filledSpecifier = fillSpecifierTemplate(result.specifier, result.pattern, formattedDate);

        // Generate date modifier string if date override is enabled
        let dateModifier: string | undefined = undefined;
        if (enableDateOverride && formattedDate) {
            const year = formattedDate.getFullYear();
            const month = String(formattedDate.getMonth() + 1).padStart(2, '0');
            const day = String(formattedDate.getDate()).padStart(2, '0');
            const dateString = `${year}${month}${day}`;
            dateModifier = `${dateFilterType}:${dateString}`;
        }

        // Add to search history
        searchHistory = [{
            name: result.pattern.name,
            specifier: filledSpecifier,
            url: formattedURL,
            timestamp: new Date(),
            dateModifier: dateModifier
        }, ...searchHistory]; // Newest first

        // Open the search in a new tab
        window.open(formattedURL, '_blank');
    }

    // ============================================================================
    // LocalStorage Persistence (Custom User Search Terms)
    // ============================================================================

    // Load custom terms from localStorage and add to the active pool
    function loadCustomTermsIntoPool() {
        const customTerms = JSON.parse(localStorage.getItem('customSearchTerms') || '[]');

        // Remove any existing custom terms first (to avoid duplicates)
        allSearchTerms = allSearchTerms.filter(term => !term.isCustom);

        // Add custom terms to the main search terms list
        if (customTerms.length > 0) {
            allSearchTerms = [...allSearchTerms, ...customTerms];
        }
    }

    // Remove all custom terms from the active pool
    function removeCustomTermsFromPool() {
        allSearchTerms = allSearchTerms.filter(term => !term.isCustom);
    }

    // Converts Strings to a Search Term JSON Object
    function developSearchTerm(name: string, specifiers: string[], genre: string, age: string, constraint: [string, string]): SearchPattern {

        // Develop Search Term Object
        const searchTerm: SearchPattern = {
            name,
            genre,
            age,
            specifiers,
            constraint,
            isCustom: true // Mark all custom-created terms
        };

        return searchTerm;
    }

    // Save a custom search term to LocalStorage
    function saveSearchTerm() {
        // Filter out empty specifiers
        const specifiersArray = customSpecifiersList
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0);

        // Require at least one of: name OR specifier
        if (!customName.trim() && specifiersArray.length === 0) {
            alert('Please enter at least a name OR a specifier');
            return;
        }

        // Build constraint array based on constraint type
        let constraint: [string, string] = ['', ''];
        if (customConstraintType !== 'none' && customConstraintDate) {
            constraint = [customConstraintType, customConstraintDate];
        }

        const searchTerm = developSearchTerm(
            customName.trim() || '', // Allow empty name
            specifiersArray.length > 0 ? specifiersArray : [''], // Ensure at least empty string
            customGenre || 'Custom', // Ensure genre defaults to "Custom"
            customAge,
            constraint
        );

        saveSearchTermToStorage(searchTerm);

        // If custom terms are enabled, reload the pool to include the new term
        if (enableUserTerms) {
            loadCustomTermsIntoPool();
        }

        // Clear form
        clearForm();

        alert('Search term saved!' + (enableUserTerms ? ' It has been added to your search pool.' : ' Enable custom terms to use it.'));
    }

    // Clear the form and reset to defaults
    function clearForm() {
        customName = '';
        customSpecifiersList = [''];
        customGenre = 'Custom';
        customAge = '';
        customConstraintType = 'none';
        customConstraintDate = '';
        selectedTermIndex = null;
    }

    // Add a new empty specifier field
    function addSpecifierField() {
        customSpecifiersList = [...customSpecifiersList, ''];
    }

    // Remove a specifier field at the given index
    function removeSpecifierField(index: number) {
        if (customSpecifiersList.length > 1) {
            customSpecifiersList = customSpecifiersList.filter((_, i) => i !== index);
        }
    }

    // Delete the currently selected custom term
    function deleteCurrentTerm() {
        if (selectedTermIndex === null) {
            alert('No term selected to delete. Please select a term from the dropdown first.');
            return;
        }

        const customTerms = JSON.parse(localStorage.getItem('customSearchTerms') || '[]');
        if (selectedTermIndex >= 0 && selectedTermIndex < customTerms.length) {
            const termName = customTerms[selectedTermIndex].name || 'this term';
            if (confirm(`Are you sure you want to delete "${termName}"?`)) {
                // Remove the term at the selected index
                customTerms.splice(selectedTermIndex, 1);
                localStorage.setItem('customSearchTerms', JSON.stringify(customTerms));

                // Update reactive list
                refreshSavedCustomTerms();

                // Reload custom terms if enabled
                if (enableUserTerms) {
                    loadCustomTermsIntoPool();
                }

                // Clear the form
                clearForm();

                alert('Term deleted successfully!');
            }
        }
    }

    // Load a custom term from localStorage into the form
    function loadTermIntoForm(index: number) {
        const customTerms = JSON.parse(localStorage.getItem('customSearchTerms') || '[]');
        if (index >= 0 && index < customTerms.length) {
            const term = customTerms[index];
            customName = term.name || '';
            customSpecifiersList = term.specifiers.length > 0 ? [...term.specifiers] : [''];
            customGenre = term.genre || 'Custom';
            customAge = term.age || '';

            // Handle constraint
            if (term.constraint && term.constraint[0]) {
                customConstraintType = term.constraint[0];
                customConstraintDate = term.constraint[1] || '';
            } else {
                customConstraintType = 'none';
                customConstraintDate = '';
            }

            selectedTermIndex = index;
        }
    }

    // Refresh the saved custom terms list from localStorage
    function refreshSavedCustomTerms() {
        savedCustomTerms = JSON.parse(localStorage.getItem('customSearchTerms') || '[]');
    }

    function saveSearchTermToStorage(searchTerm: SearchPattern) {
        const existing = JSON.parse(localStorage.getItem('customSearchTerms') || '[]');
        existing.push(searchTerm);
        localStorage.setItem('customSearchTerms', JSON.stringify(existing));
        refreshSavedCustomTerms(); // Update reactive list
    }

    // Reload custom terms from localStorage (manual refresh)
    function loadSearchTerms() {
        const customTerms = JSON.parse(localStorage.getItem('customSearchTerms') || '[]');
        if (customTerms.length === 0) {
            alert('No custom terms saved yet!');
            return;
        }

        // Reload custom terms into the pool
        loadCustomTermsIntoPool();

        alert(`Reloaded ${customTerms.length} custom search term(s)!`);
    }

    // ============================================================================
    // Import/Export Functions
    // ============================================================================

    // Export custom terms to JSON file
    function exportCustomTerms() {
        const customTerms = JSON.parse(localStorage.getItem('customSearchTerms') || '[]');

        if (customTerms.length === 0) {
            alert('No custom terms to export!');
            return;
        }

        // Generate timestamped filename
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const filename = `my-youtube-terms-${year}-${month}-${day}-${hours}${minutes}${seconds}.json`;

        // Create and download file
        const jsonString = JSON.stringify(customTerms, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        alert(`Exported ${customTerms.length} custom term(s) to ${filename}`);
    }

    // Validate that a search pattern has required fields
    function validateSearchPattern(term: any): boolean {
        // Must have at least name OR specifier
        const hasName = term.name && term.name.trim().length > 0;
        const hasSpecifiers = term.specifiers && Array.isArray(term.specifiers) &&
                             term.specifiers.some((s: string) => s && s.trim().length > 0);

        return hasName || hasSpecifiers;
    }

    // Simple import: Replace all existing terms
    function importSimple() {
        if (!selectedFile) {
            alert('Please select a file first');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const importedTerms = JSON.parse(content);

                if (!Array.isArray(importedTerms)) {
                    alert('Invalid file format: Expected an array of search terms');
                    return;
                }

                // Validate and filter terms
                let successCount = 0;
                let failedCount = 0;
                const validTerms: SearchPattern[] = [];

                importedTerms.forEach((term: any) => {
                    if (validateSearchPattern(term)) {
                        // Ensure isCustom flag is set
                        validTerms.push({ ...term, isCustom: true });
                        successCount++;
                    } else {
                        failedCount++;
                    }
                });

                // Replace all existing terms
                localStorage.setItem('customSearchTerms', JSON.stringify(validTerms));

                // Update stats and reload
                importStats = { success: successCount, failed: failedCount };
                if (enableUserTerms) {
                    loadCustomTermsIntoPool();
                }

                alert(`Import complete!\n✓ ${successCount} imported\n✗ ${failedCount} failed`);
            } catch (error) {
                alert('Error reading file: Invalid JSON format');
            }
        };
        reader.readAsText(selectedFile);
    }

    // Smart import: Merge duplicates (matching name AND age)
    function importMerge() {
        if (!selectedFile) {
            alert('Please select a file first');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const importedTerms = JSON.parse(content);

                if (!Array.isArray(importedTerms)) {
                    alert('Invalid file format: Expected an array of search terms');
                    return;
                }

                // Get existing terms
                const existing = JSON.parse(localStorage.getItem('customSearchTerms') || '[]');
                let successCount = 0;
                let failedCount = 0;

                importedTerms.forEach((importedTerm: any) => {
                    if (!validateSearchPattern(importedTerm)) {
                        failedCount++;
                        return;
                    }

                    // Find duplicate (matching name AND age)
                    const duplicateIndex = existing.findIndex((existingTerm: SearchPattern) =>
                        existingTerm.name === importedTerm.name &&
                        existingTerm.age === importedTerm.age
                    );

                    if (duplicateIndex >= 0) {
                        // Merge with existing term
                        const existingTerm = existing[duplicateIndex];

                        // Combine unique specifiers
                        const combinedSpecifiers = Array.from(new Set([
                            ...(existingTerm.specifiers || []),
                            ...(importedTerm.specifiers || [])
                        ]));

                        // Combine constraints
                        const existingConstraint = existingTerm.constraint || ['', ''];
                        const importedConstraint = importedTerm.constraint || ['', ''];
                        const combinedConstraint: [string, string] = [
                            importedConstraint[0] || existingConstraint[0],
                            importedConstraint[1] || existingConstraint[1]
                        ];

                        // Update existing term with merged data
                        existing[duplicateIndex] = {
                            name: existingTerm.name,
                            specifiers: combinedSpecifiers,
                            genre: importedTerm.genre || existingTerm.genre, // Keep genre from imported
                            age: existingTerm.age,
                            constraint: combinedConstraint,
                            isCustom: true
                        };
                    } else {
                        // Add as new term
                        existing.push({ ...importedTerm, isCustom: true });
                    }
                    successCount++;
                });

                // Save merged terms
                localStorage.setItem('customSearchTerms', JSON.stringify(existing));

                // Update stats and reload
                importStats = { success: successCount, failed: failedCount };
                if (enableUserTerms) {
                    loadCustomTermsIntoPool();
                }

                alert(`Import complete!\n✓ ${successCount} imported\n✗ ${failedCount} failed`);
            } catch (error) {
                alert('Error reading file: Invalid JSON format');
            }
        };
        reader.readAsText(selectedFile);
    }

    // Delete all custom terms with confirmation
    function deleteAllCustomTerms() {
        const customTerms = JSON.parse(localStorage.getItem('customSearchTerms') || '[]');

        if (customTerms.length === 0) {
            alert('No custom terms to delete');
            return;
        }

        const confirmed = confirm(`Are you sure you want to delete all ${customTerms.length} custom term(s)?\n\nThis action cannot be undone.`);

        if (confirmed) {
            localStorage.removeItem('customSearchTerms');
            removeCustomTermsFromPool();
            importStats = null;
            selectedFile = null;
            alert('All custom terms have been deleted');
        }
    }

    // Handle file selection from input
    function handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            selectedFile = input.files[0];
            importStats = null; // Clear previous stats
        }
    }

    // Handle drag over event
    function handleDragOver(event: DragEvent) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    }

    // Handle file drop
    function handleFileDrop(event: DragEvent) {
        event.preventDefault();
        if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
            selectedFile = event.dataTransfer.files[0];
            importStats = null; // Clear previous stats
        }
    }

    // ============================================================================
    // END OF SCRIPT
</script>

<style>
    /* ========================================================================
       HOME PAGE STYLES
       Global styles are in +layout.svelte
       ======================================================================== */

    /* === MAIN CONTENT CONTAINER === */
    .content-body {
        background-color: #f5f5f5;
        border: 0.5rem solid black;
        flex: 1;
        overflow-y: auto;
        box-sizing: border-box;
    }

    /* === ADVANCED SETTINGS TAB SYSTEM === */
    .advanced-settings-wrapper {
        margin: 1.5rem 2rem;
    }

    .advanced-tabs-bar {
        display: flex;
        align-items: flex-end;
        gap: 0.25rem;
        background-color: var(--color-primary);
        padding: 0.2rem 0 0 2rem;
        border: 2px solid black;
        border-bottom: none;
    }

    .advanced-tab {
        background-color: rgba(255, 255, 255, 0.5);
        border: 2px solid black;
        border-bottom: none;
        border-radius: 0.5rem 0.5rem 0 0;
        padding: 0.75rem 1.5rem;
        font-size: 1.25rem;
        font-weight: bold;
        color: black;
        cursor: pointer;
        transition: all var(--transition-std);
        margin-bottom: -2px;
        font-family: 'Arial', sans-serif;
    }

    .advanced-tab:hover {
        background-color: rgba(255, 255, 255, 0.8);
    }

    .advanced-tab.active {
        background-color: white;
        margin-bottom: -2px;
        padding-top: calc(0.75rem + 2px);
        z-index: 10;
    }

    .advanced-tab-content {
        background-color: white;
        border: 2px solid black;
        min-height: 200px;
    }

    .tab-panel {
        padding: 2rem;
    }

    .grid-container-tabs {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1.5rem;
    }

    .grid-item-tabs {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .coming-soon {
        text-align: center;
        padding: 3rem;
        color: #666;
    }

    .coming-soon h3 {
        font-size: 1.5rem;
        margin-bottom: 1rem;
    }

    .coming-soon p {
        font-size: 1rem;
        color: #999;
    }

    .custom-terms-section {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    /* === MAIN GRID CONTAINERS === */
    .grid-container {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1.5rem;
        max-width: 100%;
        margin: 0 auto;
        padding-bottom: 1.5rem;
        background-color: #f5f5f5;
    }

    .grid-item {
        padding: 1.5rem 1.5rem 0 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    /* === BUTTONS === */
    .top-buttons {
        display: flex;
        gap: 1rem;
        justify-content: space-evenly;
    }

    .rand-button {
        padding: 0.75rem 2rem;
        font-size: 1rem;
        background-color: lightgoldenrodyellow;
        color: black;
        border: var(--border-std);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-weight: bold;
        transition: transform var(--transition-std);
        width: 25%;
        position: relative;
    }

    .rand-button:hover {
        transform: scale(1.01);
    }

    .randomness-badge {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        font-size: 1.5rem;
        animation: pulse 2s ease-in-out infinite;
        filter: drop-shadow(0 2px 4px rgba(220, 38, 38, 0.3));
    }

    @keyframes pulse {
        0%, 100% {
            transform: scale(1);
            opacity: 1;
        }
        50% {
            transform: scale(1.1);
            opacity: 0.8;
        }
    }

    /* === FILTERS & CHECKBOXES === */
    .filter-container {
        display: flex;
        flex-direction: row;
        gap: 0.75rem;
        padding: 0 2rem;
        justify-content: center;
        align-items: center;
    }

    .filter-container span {
        font-size: 1rem;
        font-weight: 500;
    }

    .filter-select {
        padding: 0.5rem 1rem;
        font-size: 1rem;
        background-color: var(--color-bg);
        color: black;
        border: var(--border-std);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-weight: bold;
    }

    .checkbox-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .checkbox-item input[type="checkbox"] {
        width: 1.5rem;
        height: 1.5rem;
        cursor: pointer;
    }

    .checkbox-item label {
        font-size: 1.25rem;
        font-weight: 500;
        cursor: pointer;
    }

    .checkbox-item label h4 {
        font-size: 1.25rem;
        margin: 0;
    }

    .filter-select:disabled {
        background-color: #e0e0e0;
        cursor: not-allowed;
        opacity: 0.6;
    }

    /* === DROPDOWN COMPONENTS (Genre & Name Selectors) === */
    .genre-selector {
        position: relative;
        width: 100%;
        max-width: 400px;
    }

    .dropdown-button {
        width: 100%;
        padding: 0.75rem 1rem;
        font-size: 1rem;
        background-color: var(--color-primary);
        color: black;
        border: var(--border-std);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-weight: bold;
        display: flex;
        justify-content: space-between;
        align-items: center;
        transition: transform var(--transition-std);
    }

    .dropdown-button:hover {
        transform: scale(1.01);
    }

    .dropdown-arrow {
        font-size: 0.8rem;
    }

    .genre-dropdown-menu {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        margin-top: 0.5rem;
        background-color: white;
        border: var(--border-std);
        border-radius: var(--radius-md);
        max-height: 300px;
        overflow-y: auto;
        z-index: 1000;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .genre-checkbox-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        cursor: pointer;
        transition: background-color var(--transition-std);
    }

    .genre-checkbox-item:hover {
        background-color: #f0f0f0;
    }

    .genre-checkbox-item.select-all {
        font-weight: bold;
        background-color: var(--color-bg);
    }

    .genre-checkbox-item input[type="checkbox"] {
        width: 1.25rem;
        height: 1.25rem;
        cursor: pointer;
    }

    .genre-checkbox-item span {
        font-size: 1rem;
        user-select: none;
    }

    .genre-divider {
        height: 2px;
        background-color: #e0e0e0;
        margin: 0.25rem 0;
    }

    /* === FORM CONTAINERS (Custom Terms & Import/Export) === */
    .custom-terms-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
        margin: 1.5rem 2rem;
    }

    .custom-terms-creator, .import-export-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.5rem;
        padding: 2rem;
        background-color: #fff;
        border: var(--border-thick);
        border-radius: var(--radius-md);
        margin: 0;
        max-width: none;
    }

    .custom-terms-creator h3, .import-export-container h3 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: bold;
    }

    .form-section {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .form-row {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        width: 100%;
    }

    .form-row label {
        font-weight: bold;
        font-size: 1rem;
    }

    .form-row input,
    .form-row select {
        padding: 0.75rem;
        font-size: 1rem;
        border: var(--border-std);
        border-radius: var(--radius-sm);
        font-family: 'Arial', sans-serif;
    }

    .form-row input:focus,
    .form-row select:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px rgba(32, 178, 170, 0.2);
    }

    .form-row.optional label {
        color: #666;
    }

    .form-row.optional input,
    .form-row.optional select {
        background-color: #f9f9f9;
        border-color: #ccc;
    }

    .form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
        width: 100%;
    }

    .custom-term-button {
        padding: 0.75rem 2rem;
        font-size: 1rem;
        background-color: var(--color-primary);
        color: black;
        border: var(--border-std);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-weight: bold;
        transition: transform var(--transition-std);
    }

    .custom-term-button:hover {
        transform: scale(1.01);
    }

    .custom-term-button h2 {
        margin: 0;
        font-size: 1rem;
    }

    .button-group {
        display: flex;
        gap: 0.5rem;
    }

    .delete-button {
        background-color: #dc3545;
        color: white;
    }

    .delete-button:hover {
        background-color: #c82333;
    }

    .save-button {
        background-color: var(--color-primary);
        color: black;
    }

    .form-top-row {
        display: flex;
        gap: 1rem;
        width: 100%;
        align-items: center;
    }

    .term-selector {
        flex: 1;
    }

    .term-selector select {
        width: 100%;
        padding: 0.75rem;
        font-size: 1rem;
        border: var(--border-std);
        border-radius: var(--radius-sm);
        background-color: var(--color-primary);
        color: black;
        font-weight: bold;
        cursor: pointer;
        font-family: 'Arial', sans-serif;
    }

    .specifier-container {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
    }

    .specifier-inputs {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .specifier-control-bar {
        display: flex;
        flex-direction: column;
        width: 3rem;
        border: var(--border-std);
        border-radius: var(--radius-sm);
        overflow: hidden;
        align-self: stretch;
    }

    .specifier-add-btn, .specifier-remove-btn {
        flex: 1;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        font-weight: bold;
        color: #000;
        transition: background-color var(--transition-std);
    }

    .specifier-add-btn {
        background-color: var(--color-success);
        border-bottom: 1px solid black;
    }

    .specifier-add-btn:hover {
        background-color: #7CFC00;
    }

    .specifier-remove-btn {
        background-color: var(--color-danger);
    }

    .specifier-remove-btn:hover {
        background-color: #FF4444;
    }

    .specifier-remove-btn:disabled {
        background-color: #CCCCCC;
        cursor: not-allowed;
        opacity: 0.5;
    }

    .more-info-toggle {
        display: flex;
        gap: 0.75rem;
        margin-bottom: 1rem;
    }

    .more-info-toggle input[type="checkbox"] {
        width: 1.25rem;
        height: 1.25rem;
        cursor: pointer;
    }

    .more-info-toggle label {
        font-size: 1rem;
        font-weight: 500;
        cursor: pointer;
        color: #666;
    }

    .file-drop-zone {
        width: 100%;
        min-height: 150px;
        border: 3px dashed #999;
        border-radius: var(--radius-md);
        background-color: #f9f9f9;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all var(--transition-std);
    }

    .file-drop-zone:hover, .file-drop-zone.active {
        border-color: var(--color-primary);
    }

    .file-drop-zone:hover {
        background-color: #f0ffff;
    }

    .file-drop-zone.active {
        background-color: #e0ffff;
    }

    .drop-zone-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        text-align: center;
    }

    .drop-zone-text, .drop-zone-subtext {
        margin: 0;
    }

    .drop-zone-text {
        font-size: 1rem;
        color: #333;
    }

    .drop-zone-subtext {
        font-size: 0.9rem;
        color: #666;
    }

    .file-select-button {
        padding: 0.5rem 1.5rem;
        background-color: var(--color-primary);
        color: black;
        border: var(--border-std);
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-weight: bold;
        transition: transform var(--transition-std);
    }

    .file-select-button:hover {
        transform: scale(1.01);
    }

    .import-button-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
        width: 100%;
    }

    .import-button {
        padding: 1rem;
        background-color: var(--color-success);
        color: black;
        border: var(--border-std);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-weight: bold;
        transition: transform var(--transition-std);
        text-align: center;
    }

    .import-button:hover {
        transform: scale(1.01);
    }

    .import-button h2, .danger-button h2 {
        margin: 0;
        font-size: 1rem;
    }

    .import-button h2 {
        margin-bottom: 0.5rem;
    }

    .import-button p {
        margin: 0;
        font-size: 0.85rem;
        font-weight: normal;
        color: #333;
    }

    .danger-button {
        width: 100%;
        padding: 0.75rem 2rem;
        font-size: 1rem;
        background-color: var(--color-danger);
        color: black;
        border: var(--border-std);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-weight: bold;
        transition: all var(--transition-std);
    }

    .danger-button:hover {
        transform: scale(1.01);
    }

    .import-stats {
        width: 100%;
        padding: 1rem;
        background-color: #e8f5e9;
        border: 2px solid #4caf50;
        border-radius: var(--radius-md);
        text-align: center;
    }

    .import-stats p {
        margin: 0;
        font-size: 1rem;
        color: #333;
    }

    /* ========================================================================
       RESPONSIVE STYLES
       ======================================================================== */

    /* === TABLET (960px - 769px) === */
    @media (max-width: 960px) and (min-width: 769px) {
        .content-body {
            border-width: 0.375rem;
        }

        .advanced-settings-wrapper {
            margin: 1rem;
        }

        .advanced-tabs-bar {
            padding: 0.2rem 0 0 2rem ;
        }

        .advanced-tab {
            font-size: 1rem;
            padding: 0.5rem 1rem;
        }

        .tab-panel {
            padding: 1.5rem;
        }

        .grid-container {
            grid-template-columns: 1fr;
            gap: 1rem;
            padding: 1rem;
            display: block;
        }

        .grid-item {
            padding: 1.25rem;
        }

        .rand-button {
            width: 100%;
            max-width: 400px;
            margin: 0 auto;
            padding: 0.65rem 1.5rem;
            font-size: 0.95rem;
        }

        .filter-container {
            padding: 0 1rem;
            gap: 0.65rem;
        }

        .filter-select {
            padding: 0.45rem 0.75rem;
            font-size: 0.9rem;
        }

        .genre-selector {
            max-width: 100%;
        }

        .dropdown-button {
            padding: 0.65rem 0.9rem;
            font-size: 0.9rem;
        }

        .custom-terms-grid {
            grid-template-columns: 1fr;
            margin: 1rem;
            gap: 1.5rem;
        }
    }

    /* === MOBILE (768px and below) === */
    @media (max-width: 768px) {
        .content-body {
            border-width: 0.25rem;
            min-height: auto;
        }

        .advanced-settings-wrapper {
            margin: 0.5rem;
        }

        .advanced-tabs-bar {
            padding: 0.2rem 0 0 2rem ;
            overflow-x: auto;
        }

        .advanced-tab {
            font-size: 0.75rem;
            padding: 0.5rem 1rem;
            white-space: nowrap;
        }

        .advanced-tab.active {
            padding-bottom: calc(0.5rem + 2px);
        }

        .tab-panel {
            padding: 1rem;
        }

        .grid-container-tabs {
            grid-template-columns: 1fr;
            gap: 1rem;
        }

        .grid-container {
            grid-template-columns: 1fr;
            gap: 1rem;
            padding: 1rem;
            display: flex;
            align-content: center;
        }

        .grid-item {
            padding: 1rem;
            gap: 0.5rem;
        }

        .top-buttons {
            flex-direction: column;
            gap: 0.5rem;
        }

        .rand-button {
            width: 100%;
            padding: 0.4rem 0.8rem;
            font-size: 0.7rem;
        }

        .rand-button h2 {
            font-size: 0.8rem;
            margin: 0;
        }

        .filter-container {
            flex-direction: column;
            padding: 0 0.5rem;
            gap: 0.4rem;
            flex-wrap: wrap;
        }

        .filter-container h2 {
            font-size: 0.75rem;
            margin: 0;
        }

        .filter-select {
            padding: 0.4rem;
            font-size: 0.7rem;
            width: 100%;
            max-width: 200px;
        }

        .filter-container input[type="date"] {
            width: 100%;
            max-width: 200px;
        }

        .checkbox-item input[type="checkbox"] {
            width: 1rem;
            height: 1rem;
        }

        .checkbox-item label h4 {
            font-size: 0.75rem;
        }

        .genre-selector {
            max-width: 100%;
        }

        .dropdown-button {
            padding: 0.4rem 0.6rem;
            font-size: 0.7rem;
        }

        .genre-dropdown-menu {
            max-height: 200px;
        }

        .genre-checkbox-item {
            padding: 0.4rem 0.6rem;
            gap: 0.4rem;
        }

        .genre-checkbox-item input[type="checkbox"] {
            width: 0.85rem;
            height: 0.85rem;
        }

        .genre-checkbox-item span {
            font-size: 0.7rem;
        }

        .custom-terms-grid {
            grid-template-columns: 1fr;
            margin: 1rem;
            gap: 1rem;
        }

        .custom-terms-creator, .import-export-container {
            margin: 0;
            padding: 1rem;
            gap: 1rem;
        }

        .custom-terms-creator h3, .import-export-container h3 {
            font-size: 1rem;
        }

        .form-section {
            gap: 0.75rem;
        }

        .form-row {
            gap: 0.4rem;
        }

        .form-row label {
            font-size: 0.75rem;
        }

        .form-row input,
        .form-row select {
            padding: 0.5rem;
            font-size: 0.75rem;
        }

        .form-grid {
            grid-template-columns: 1fr;
            gap: 0.75rem;
        }

        .custom-term-button {
            padding: 0.5rem 1rem;
            font-size: 0.75rem;
        }

        .custom-term-button h2 {
            font-size: 0.75rem;
        }
    }

    /* === EXTRA SMALL MOBILE (480px and below) === */
    @media (max-width: 480px) {
        .advanced-tab {
            font-size: 0.65rem;
            padding: 0.4rem 0.75rem;
        }

        .filter-container h2,
        .rand-button h2 {
            font-size: 0.7rem;
        }

        .dropdown-button,
        .genre-checkbox-item span {
            font-size: 0.65rem;
        }
    }

    /* === TERM LOOKUP TAB STYLES === */
    .term-lookup-section {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .term-lookup-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .lookup-search-input {
        padding: 0.75rem 1rem;
        font-size: 1rem;
        border: 2px solid #ddd;
        border-radius: 8px;
        background-color: var(--color-bg);
        transition: border-color var(--transition-std);
        box-sizing: border-box;
    }

    .lookup-search-input:focus {
        outline: none;
        border-color: var(--color-primary);
    }

    .lookup-filters-row {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex-wrap: wrap;
    }

    .lookup-filter {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .lookup-filter label {
        font-size: 0.9rem;
        font-weight: 600;
    }

    .lookup-filter select {
        padding: 0.5rem 0.75rem;
        font-size: 0.9rem;
        border: 2px solid #ddd;
        border-radius: 6px;
        background-color: var(--color-bg);
        cursor: pointer;
        transition: border-color var(--transition-std);
    }

    .lookup-filter select:focus {
        outline: none;
        border-color: var(--color-primary);
    }

    .lookup-sort {
        margin-left: auto;
    }

    .lookup-sort-button {
        padding: 0.5rem 1rem;
        font-size: 0.9rem;
        font-weight: 600;
        background-color: var(--color-bg);
        border: 2px solid #ddd;
        border-radius: 6px;
        cursor: pointer;
        transition: all var(--transition-std);
    }

    .lookup-sort-button:hover {
        background-color: var(--color-primary);
        border-color: var(--color-primary);
    }

    .lookup-results-count {
        font-size: 0.9rem;
        color: #666;
        font-weight: 600;
    }

    .term-lookup-list {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        max-height: 500px;
        overflow-y: auto;
        border: 2px solid #ddd;
        border-radius: 8px;
        background-color: var(--color-bg);
        padding: 0.5rem;
        box-sizing: border-box;
    }

    .term-lookup-item-wrapper {
        display: flex;
        flex-direction: column;
    }

    .term-lookup-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        transition: background-color var(--transition-std);
        border-radius: 4px;
        width: 100%;
    }

    .term-lookup-item:hover {
        background-color: var(--color-primary);
    }

    .term-lookup-item.expanded {
        background-color: var(--color-primary);
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
    }

    .term-lookup-name {
        font-size: 1rem;
        font-weight: 500;
        color: #000;
    }

    .term-lookup-specifier {
        font-size: 0.9rem;
        color: #aaa;
        margin-left: 4px;
    }

    .term-lookup-empty {
        padding: 2rem;
        text-align: center;
        color: #999;
    }

    .term-lookup-empty p {
        font-size: 1rem;
    }

    /* === TERM DETAIL BOX === */
    .term-detail-box {
        background-color: #fff;
        color: #000;
        border: 2px solid #ddd;
        border-top: none;
        border-radius: 0 0 4px 4px;
        padding: 1rem;
        margin-top: -4px;
    }

    .term-detail-section {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .term-detail-section.previous-searches {
        margin-top: 0.5rem;
    }

    .term-detail-row {
        display: flex;
        gap: 0.75rem;
        align-items: baseline;
    }

    .term-detail-label {
        font-weight: 700;
        font-size: 0.95rem;
        /* color: #fff; */
        min-width: 120px;
    }

    .term-detail-value {
        font-size: 0.95rem;
        /* color: #fff; */
        flex: 1;
    }

    .term-detail-divider {
        height: 2px;
        /* background-color: #fff; */
        margin: 0.5rem 0 1rem 0;
    }

    .term-detail-section h4 {
        font-size: 1rem;
        font-weight: 700;
        /* color: #fff; */
        margin: 0 0 0.5rem 0;
    }

    .coming-soon-text {
        font-size: 0.9rem;
        color: #aaa;
        font-style: italic;
    }

    .no-history-text {
        font-size: 0.9rem;
        color: #aaa;
        font-style: italic;
    }

    .term-history-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .term-history-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 1rem;
        background-color: #f5f5f5;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        text-align: left;
        transition: background-color var(--transition-std);
    }

    .term-history-item:hover {
        background-color: lightcyan;
    }

    .term-history-specifier {
        font-size: 0.9rem;
        font-weight: 600;
        color: #333;
    }

    .term-history-timestamp {
        font-size: 0.8rem;
        color: #666;
    }

    .specifier-example {
        color: #aaa;
        font-size: 0.85rem;
    }

    .specifier-list {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .specifier-item {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
    }

    /* === RANDOMNESS TAB === */
    .randomness-section {
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .randomness-controls {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1rem;
        background-color: #f9f9f9;
        border: 2px solid black;
        border-radius: 0.5rem;
    }

    .randomness-description {
        margin: 0;
        font-size: 0.9rem;
        color: #555;
        font-style: italic;
    }

    .checkbox-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
        font-weight: bold;
    }

    .checkbox-label input[type="checkbox"] {
        cursor: pointer;
        width: 18px;
        height: 18px;
    }

    .graphs-container {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
    }

    @media (max-width: 960px) {
        .graphs-container {
            grid-template-columns: 1fr;
        }
    }

    .distribution-selector {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
    }

    .distribution-selector label {
        font-weight: bold;
        font-size: 0.9rem;
    }

    .distribution-selector select {
        padding: 0.4rem 0.8rem;
        font-size: 0.9rem;
        border: 2px solid black;
        border-radius: 0.25rem;
        background-color: white;
        cursor: pointer;
    }

    .distribution-tooltip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        background: rgba(220, 38, 38, 0.1);
        border: 2px solid rgba(220, 38, 38, 0.3);
        border-radius: 50%;
        color: rgba(220, 38, 38, 0.9);
        font-size: 0.75rem;
        font-weight: bold;
        cursor: help;
        transition: all 0.2s;
    }

    .distribution-tooltip:hover {
        background: rgba(220, 38, 38, 0.2);
        transform: scale(1.1);
    }

    .graph-container {
        padding: 1rem;
        border: 2px solid black;
        border-radius: 0.5rem;
        background-color: white;
        transition: all 0.3s ease-in-out;
    }

    .graph-container:hover {
        box-shadow: 0 4px 12px rgba(220, 38, 38, 0.15);
    }

    .graph-container.disabled {
        opacity: 0.5;
        pointer-events: none;
        background-color: #f5f5f5;
    }

    .graph-container h3 {
        margin: 0 0 0.5rem 0;
        font-size: 1.1rem;
        color: #333;
    }

    .graph-description {
        margin: 0 0 0.75rem 0;
        font-size: 0.85rem;
        color: #666;
        font-style: italic;
    }

    .graph-canvas-wrapper {
        position: relative;
        width: 100%;
        height: 300px;
        cursor: grab;
        user-select: none;
        background-color: white;
        overflow: hidden;
    }

    .graph-canvas-wrapper:active {
        cursor: grabbing;
    }

    .graph-canvas-wrapper canvas {
        width: 100% !important;
        height: 100% !important;
    }

    .graph-info {
        display: flex;
        gap: 2rem;
        justify-content: center;
        margin-top: 0.75rem;
        padding-top: 0.75rem;
        border-top: 1px solid #ddd;
    }

    .graph-info p {
        margin: 0;
        font-size: 0.9rem;
        font-weight: bold;
        color: #555;
    }

    /* Slider Controls */
    .slider-controls {
        margin-top: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .slider-group {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .slider-group label {
        font-size: 0.85rem;
        font-weight: bold;
        color: #333;
    }

    .distribution-slider {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: linear-gradient(to right, #f5f5f0, rgba(220, 38, 38, 0.3));
        outline: none;
        -webkit-appearance: none;
        appearance: none;
    }

    .distribution-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(220, 38, 38, 0.9);
        cursor: pointer;
        border: 2px solid white;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        transition: transform 0.1s;
    }

    .distribution-slider::-webkit-slider-thumb:hover {
        transform: scale(1.15);
        background: rgba(220, 38, 38, 1);
    }

    .distribution-slider::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(220, 38, 38, 0.9);
        cursor: pointer;
        border: 2px solid white;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        transition: transform 0.1s;
    }

    .distribution-slider::-moz-range-thumb:hover {
        transform: scale(1.15);
        background: rgba(220, 38, 38, 1);
    }

    /* Sample Preview */
    .sample-preview {
        margin-top: 1.5rem;
        padding: 1rem;
        background: linear-gradient(135deg, #fff9f9 0%, #fff5f5 100%);
        border: 2px solid rgba(220, 38, 38, 0.2);
        border-radius: 0.5rem;
    }

    .preview-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
    }

    .preview-title {
        font-weight: bold;
        color: rgba(220, 38, 38, 0.9);
        font-size: 0.9rem;
    }

    .preview-refresh-btn {
        padding: 0.25rem 0.75rem;
        background: rgba(220, 38, 38, 0.1);
        border: 1px solid rgba(220, 38, 38, 0.3);
        border-radius: 0.25rem;
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: bold;
        color: rgba(220, 38, 38, 0.9);
        transition: all 0.2s;
    }

    .preview-refresh-btn:hover {
        background: rgba(220, 38, 38, 0.2);
    }

    .preview-refresh-btn:active {
        transform: scale(0.95);
    }

    .preview-samples {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .sample-value {
        padding: 0.4rem 0.8rem;
        background: white;
        border: 2px solid rgba(220, 38, 38, 0.3);
        border-radius: 0.25rem;
        font-weight: bold;
        font-size: 0.85rem;
        color: rgba(220, 38, 38, 0.9);
        font-family: 'Courier New', monospace;
    }

    .preview-description {
        margin: 0;
        font-size: 0.75rem;
        color: #666;
        font-style: italic;
    }

    /* Advanced Settings Accordion */
    .advanced-settings {
        margin-top: 1rem;
        padding: 0.75rem;
        background: linear-gradient(135deg, #fafafa 0%, #f5f5f0 100%);
        border: 1px solid rgba(220, 38, 38, 0.2);
        border-radius: 0.5rem;
    }

    .advanced-settings summary {
        cursor: pointer;
        font-weight: bold;
        color: rgba(220, 38, 38, 0.9);
        font-size: 0.9rem;
        list-style: none;
        user-select: none;
        padding: 0.25rem;
    }

    .advanced-settings summary::-webkit-details-marker {
        display: none;
    }

    .advanced-settings summary::before {
        content: '▶ ';
        display: inline-block;
        transition: transform 0.2s;
    }

    .advanced-settings[open] summary::before {
        transform: rotate(90deg);
    }

    .advanced-settings .slider-group {
        margin-top: 0.75rem;
    }

    .advanced-settings .help-text {
        font-size: 0.75rem;
        color: rgba(0, 0, 0, 0.5);
        font-weight: normal;
        font-style: italic;
    }

    /* Preset Buttons */
    .preset-buttons {
        display: flex;
        gap: 0.5rem;
        margin: 0.75rem 0;
        flex-wrap: wrap;
    }

    .preset-btn {
        flex: 1;
        min-width: 100px;
        padding: 0.5rem 1rem;
        background: white;
        border: 2px solid rgba(220, 38, 38, 0.3);
        border-radius: 0.375rem;
        font-size: 0.85rem;
        font-weight: 600;
        color: rgba(220, 38, 38, 0.9);
        cursor: pointer;
        transition: all 0.2s;
    }

    .preset-btn:hover {
        background: rgba(220, 38, 38, 0.1);
        border-color: rgba(220, 38, 38, 0.6);
        transform: translateY(-2px);
        box-shadow: 0 2px 8px rgba(220, 38, 38, 0.2);
    }

    .preset-btn:active {
        transform: translateY(0);
        box-shadow: 0 1px 4px rgba(220, 38, 38, 0.2);
    }

    /* Keyboard Shortcuts Hint */
    .keyboard-hint {
        font-size: 0.8rem;
        color: rgba(0, 0, 0, 0.6);
        font-style: italic;
        margin: 0 0 0.75rem 0;
        padding: 0.5rem;
        background: rgba(220, 38, 38, 0.05);
        border-left: 3px solid rgba(220, 38, 38, 0.3);
        border-radius: 0.25rem;
    }

    /* General Tab - Coming Soon */
    .coming-soon-container {
        text-align: center;
        padding: 3rem 2rem;
        max-width: 600px;
        margin: 0 auto;
    }

    .coming-soon-container h3 {
        font-size: 2rem;
        margin-bottom: 1rem;
        color: #333;
    }

    .coming-soon-message {
        font-size: 1.5rem;
        font-weight: bold;
        color: rgba(220, 38, 38, 0.9);
        margin-bottom: 1.5rem;
    }

    .coming-soon-description {
        font-size: 1rem;
        color: #666;
        margin-bottom: 1rem;
    }

    .coming-soon-list {
        list-style: none;
        padding: 0;
        text-align: left;
        display: inline-block;
        margin-top: 1.5rem;
    }

    .coming-soon-list li {
        font-size: 1.1rem;
        padding: 0.75rem 1.5rem;
        margin: 0.5rem 0;
        background: rgba(220, 38, 38, 0.05);
        border-left: 4px solid rgba(220, 38, 38, 0.3);
        border-radius: 0.25rem;
        color: #555;
    }

    .disabled-notice {
        text-align: center;
        padding: 2rem;
        font-size: 1.1rem;
        color: #999;
        font-style: italic;
    }

    .debug-button {
        margin-top: 1rem;
        padding: 0.6rem 1rem;
        background-color: #333;
        color: white;
        border: 2px solid black;
        border-radius: 0.25rem;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: bold;
        width: 100%;
        transition: background-color 0.2s;
    }

    .debug-button:hover {
        background-color: #555;
    }

    .debug-button:active {
        background-color: #111;
    }

    /* === SEARCH HISTORY TAB === */
    .history-section {
        padding: 1rem;
    }

    .history-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
    }

    .history-section h3 {
        font-size: 1.5rem;
        margin: 0;
    }

    .refresh-button {
        padding: 0.5rem 1rem;
        background-color: white;
        color: black;
        border: 2px solid black;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9rem;
        transition: background-color 0.2s ease;
    }

    .refresh-button:hover {
        background-color: var(--color-primary);
    }

    .history-description {
        font-size: 0.9rem;
        color: #666;
        margin: 0 0 1rem 0;
    }

    .persistent-history-toggle {
        margin-bottom: 1.5rem;
        padding: 0.75rem;
        background-color: #f9f9f9;
        border: 1px solid #ddd;
        border-radius: 4px;
    }

    .persistent-history-toggle .checkbox-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
        font-size: 0.95rem;
    }

    .persistent-history-toggle input[type="checkbox"] {
        cursor: pointer;
        width: 18px;
        height: 18px;
    }

    .persistent-history-toggle span {
        user-select: none;
    }

    .empty-history {
        text-align: center;
        padding: 3rem;
        color: #999;
    }

    .empty-history p {
        font-size: 1rem;
    }

    .search-history-list {
        display: flex;
        flex-direction: column;
        border: 2px solid #ddd;
        border-radius: 8px;
        overflow: hidden;
    }

    .history-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.5rem;
        background-color: #f5f5f5;
        border: none;
        border-bottom: 1px solid #ddd;
        cursor: pointer;
        text-align: left;
        transition: background-color var(--transition-std);
    }

    .history-item:last-child {
        border-bottom: none;
    }

    .history-item.even {
        background-color: #e8e8e8;
    }

    .history-item:hover {
        background-color: var(--color-primary);
    }

    .history-term {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .history-name {
        font-size: 1rem;
        font-weight: 600;
        color: #000;
    }

    .history-specifier {
        font-size: 0.9rem;
        color: #666;
    }

    .history-date-modifier {
        font-size: 0.85rem;
        color: #0066cc;
        font-weight: 500;
        padding: 0.2rem 0.5rem;
        background-color: #e6f2ff;
        border-radius: 3px;
        font-family: monospace;
    }

    .history-timestamp {
        font-size: 0.85rem;
        color: #888;
        white-space: nowrap;
    }

    /* === CUSTOM MODAL === */
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    .modal-content {
        background-color: white;
        border: 3px solid black;
        border-radius: 8px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        animation: slideIn 0.2s ease;
    }

    @keyframes slideIn {
        from {
            transform: translateY(-20px);
            opacity: 0;
        }
        to {
            transform: translateY(0);
            opacity: 1;
        }
    }

    .modal-header {
        padding: 1.5rem;
        border-bottom: 2px solid black;
        background-color: #fff3cd;
    }

    .modal-header h3 {
        margin: 0;
        font-size: 1.5rem;
        color: #856404;
    }

    .modal-body {
        padding: 1.5rem;
    }

    .modal-body p {
        margin: 0.5rem 0;
        font-size: 1rem;
        line-height: 1.5;
    }

    .modal-body p:last-child {
        margin-top: 1rem;
    }

    .modal-footer {
        padding: 1rem 1.5rem;
        border-top: 2px solid black;
        display: flex;
        justify-content: flex-end;
        gap: 1rem;
        background-color: #f8f9fa;
    }

    .modal-button {
        padding: 0.75rem 1.5rem;
        font-size: 1rem;
        font-weight: 600;
        border: 2px solid black;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .modal-cancel {
        background-color: white;
        color: black;
    }

    .modal-cancel:hover {
        background-color: #e9ecef;
    }

    .modal-confirm {
        background-color: #dc3545;
        color: white;
    }

    .modal-confirm:hover {
        background-color: #c82333;
    }
</style>

<!-- Main Content -->
<main class="content-body">

        <!-- First Row (Random Video Button)-->
        <div class="grid-container">

            <div class="grid-item">
                <div class="top-buttons">
                    <button class="rand-button" on:click={handleFindVideos}>
                        <h2>Find Video!</h2>
                        {#if enableRandomnessMode}
                            <span class="randomness-badge" title="Randomness Mode Active">🎲</span>
                        {/if}
                    </button>
                </div>

            </div>

        </div>

        <!-- Second Row (Age Filter Options)-->
        <div class="grid-container">
            <div class="grid-item">
                <div class="filter-container" style="align-items: center;">
                    <span><h2>Show me</h2></span>
                    <select class="filter-select" on:change={handleAgeChange}>
                        <option value="any" selected>Any</option>
                        <option value="old">Old</option>
                        <option value="new">New</option>
                    </select>
                    <span><h2>Videos</h2></span>
                    {#if enableDateOverride}
                        <span><h2>{dateFilterType === 'before' ? 'Before' : dateFilterType === 'after' ? 'After' : 'On'} {new Date(customDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</h2></span>
                    {/if}
                </div>
            </div>
        </div>

        <!-- Third Row (Advanced Settings Checkbox) -->
        <div class="grid-container">
            <div class="grid-item">
                <div class="checkbox-item">
                    <input
                        type="checkbox"
                        id="advanced-settings"
                        bind:checked={showAdvancedSettings}
                    />
                    <label for="advanced-settings"><h4>Advanced Settings</h4></label>
                </div>
            </div>
        </div>

        <!-- Advanced Settings Tabbed Interface -->
        {#if showAdvancedSettings}
        <div class="advanced-settings-wrapper">

            <!-- Tab Navigation Bar -->
            <div class="advanced-tabs-bar">
                <button
                    class="advanced-tab"
                    class:active={activeTab === 'general'}
                    on:click={() => activeTab = 'general'}
                >
                    General
                </button>
                <button
                    class="advanced-tab"
                    class:active={activeTab === 'filters'}
                    on:click={() => activeTab = 'filters'}
                >
                    Filters
                </button>
                <button
                    class="advanced-tab"
                    class:active={activeTab === 'rng'}
                    on:click={() => activeTab = 'rng'}
                >
                    Randomness
                </button>
                <button
                    class="advanced-tab"
                    class:active={activeTab === 'history'}
                    on:click={() => activeTab = 'history'}
                >
                    Search History
                </button>
                <button
                    class="advanced-tab"
                    class:active={activeTab === 'lookup'}
                    on:click={() => activeTab = 'lookup'}
                >
                    Term Lookup
                </button>
                <button
                    class="advanced-tab"
                    class:active={activeTab === 'custom'}
                    on:click={() => activeTab = 'custom'}
                >
                    Custom Terms
                </button>
            </div>

            <!-- Tab Content Panels -->
            <div class="advanced-tab-content">

                <!-- GENERAL TAB -->
                {#if activeTab === 'general'}
                <div class="tab-panel general-tab">
                    <div class="coming-soon-container">
                        <h3>General Settings</h3>
                        <p class="coming-soon-message">Coming Soon</p>
                        <p class="coming-soon-description">
                            Site-wide theming and preferences will be available here.
                        </p>
                    </div>
                </div>
                {/if}

                <!-- FILTERS TAB -->
                {#if activeTab === 'filters'}
                <div class="tab-panel">
                    <div class="grid-container-tabs">

                        <!-- Genre Selector -->
                        <div class="grid-item-tabs">
                            <div class="genre-selector">
                                <button
                                    class="dropdown-button"
                                    on:click={() => genreDropdownOpen = !genreDropdownOpen}
                                >
                                    Genres: ({selectedGenres.size}/{allGenres.length})
                                    <span class="dropdown-arrow">{genreDropdownOpen ? '▲' : '▼'}</span>
                                </button>

                                {#if genreDropdownOpen}
                                    <div
                                        bind:this={genreDropdownElement}
                                        class="genre-dropdown-menu"
                                        role="listbox"
                                        tabindex="0"
                                        on:keydown={handleGenreKeydown}
                                    >
                                        <label class="genre-checkbox-item select-all">
                                            <input
                                                type="checkbox"
                                                bind:checked={selectAllGenres}
                                                on:click={toggleSelectAll}
                                            />
                                            <span>Select All</span>
                                        </label>

                                        <div class="genre-divider"></div>

                                        {#each allGenres as genre}
                                            <label
                                                class="genre-checkbox-item"
                                                id="genre-{genre}"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedGenres.has(genre)}
                                                    on:change={() => toggleGenre(genre)}
                                                />
                                                <span>{genre}</span>
                                            </label>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>

                        <!-- Name/Search Term Selector -->
                        <div class="grid-item-tabs">
                            <div class="genre-selector">
                                <button
                                    class="dropdown-button"
                                    on:click={() => nameDropdownOpen = !nameDropdownOpen}
                                >
                                    Search Terms: ({selectedNames.size}/{availableNames.length})
                                    <span class="dropdown-arrow">{nameDropdownOpen ? '▲' : '▼'}</span>
                                </button>

                                {#if nameDropdownOpen}
                                    <div
                                        bind:this={nameDropdownElement}
                                        class="genre-dropdown-menu"
                                        role="listbox"
                                        tabindex="0"
                                        on:keydown={handleNameKeydown}
                                    >
                                        <label class="genre-checkbox-item select-all">
                                            <input
                                                type="checkbox"
                                                bind:checked={selectAllNames}
                                                on:click={toggleSelectAllNames}
                                            />
                                            <span>Select All</span>
                                        </label>

                                        <div class="genre-divider"></div>

                                        {#each availableNames as item}
                                            <label
                                                class="genre-checkbox-item"
                                                id="name-{item.displayKey}"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedNames.has(item.displayKey)}
                                                    on:change={() => toggleName(item.displayKey)}
                                                />
                                                <span>
                                                    {item.name === '' ? '' : item.name}
                                                    {#if item.specifier && item.showSpecifier}
                                                        <span style="color: #aaa; margin-left: 4px;">{item.specifier}</span>
                                                    {/if}
                                                </span>
                                            </label>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>

                        <!-- Custom Date Section -->
                        <div class="grid-item-tabs">
                            <div class="checkbox-item">
                                <input
                                    type="checkbox"
                                    id="enable-date-override"
                                    bind:checked={enableDateOverride}
                                />
                                <label for="enable-date-override"><h4>Use custom date</h4></label>
                            </div>
                            {#if enableDateOverride}
                            <div class="filter-container" style="padding: 0; justify-content: flex-start; margin-top: 1rem; gap: 0.5rem;">
                                <select class="filter-select" bind:value={dateFilterType}>
                                    <option value="before">Before</option>
                                    <option value="after">After</option>
                                    <option value="exact">On</option>
                                </select>
                                <input
                                    type="date"
                                    class="filter-select"
                                    bind:value={customDate}
                                    on:change={validateCustomDate}
                                    min="2005-04-23"
                                    title="YouTube's first video was uploaded on April 23, 2005"
                                />
                            </div>
                            {/if}
                        </div>

                    </div>
                </div>
                {/if}

                <!-- RANDOMNESS TAB -->
                {#if activeTab === 'rng'}
                <div class="tab-panel randomness-tab">
                    <div class="randomness-section">

                        <!-- Master Controls -->
                        <div class="randomness-controls">
                            <label class="checkbox-label">
                                <input type="checkbox" bind:checked={enableRandomnessMode} />
                                <span>Enable Randomness Mode</span>
                            </label>
                            <p class="randomness-description">
                                When enabled, distributions control how random values are selected. Graphs appear below.
                            </p>
                        </div>

                        <!-- Graphs Container -->
                        {#if enableRandomnessMode}
                        <div class="graphs-container">

                            <!-- Integer Distribution Graph -->
                            <div class="graph-container">
                                <h3>Integer Specifier Distribution</h3>
                                <div class="distribution-selector">
                                    <label for="integer-distribution-type">Distribution:</label>
                                    <select
                                        id="integer-distribution-type"
                                        bind:value={integerDistConfig.type}
                                        on:change={() => { integerDistConfig = {...integerDistConfig}; }}
                                    >
                                        <option value="uniform">Uniform (Flat)</option>
                                        <option value="bell">Bell Curve (Normal)</option>
                                        <option value="z-curve">Z-Curve (Standard Normal)</option>
                                        <option value="t-curve">T-Curve (Heavy Tails)</option>
                                    </select>
                                    <span class="distribution-tooltip" title={
                                        integerDistConfig.type === 'uniform' ? '✨ All values equally likely across the range' :
                                        integerDistConfig.type === 'bell' ? '📊 Most values near center, fewer at edges (classic bell shape)' :
                                        integerDistConfig.type === 'z-curve' ? '📊 Same as bell curve (standard normal distribution)' :
                                        '📈 Like bell curve but with more values at the edges (heavy tails)'
                                    }>ⓘ</span>
                                </div>

                                <!-- Preset Buttons -->
                                <div class="preset-buttons">
                                    <button
                                        class="preset-btn"
                                        on:click={() => {
                                            integerDistConfig = { ...integerDistConfig, center: 0.5, spread: 0.15 };
                                        }}
                                        title="Center-focused with tight spread"
                                    >
                                        🎯 Centered
                                    </button>
                                    <button
                                        class="preset-btn"
                                        on:click={() => {
                                            integerDistConfig = { ...integerDistConfig, center: 0.25, spread: 0.2 };
                                        }}
                                        title="Skewed towards lower values"
                                    >
                                        ⬅️ Left
                                    </button>
                                    <button
                                        class="preset-btn"
                                        on:click={() => {
                                            integerDistConfig = { ...integerDistConfig, center: 0.75, spread: 0.2 };
                                        }}
                                        title="Skewed towards higher values"
                                    >
                                        ➡️ Right
                                    </button>
                                    <button
                                        class="preset-btn"
                                        on:click={() => {
                                            integerDistConfig = { ...integerDistConfig, center: 0.5, spread: 0.4 };
                                        }}
                                        title="Wide spread across all values"
                                    >
                                        📊 Wide
                                    </button>
                                </div>

                                <p class="graph-description">Drag left/right to move center, up/down to adjust spread</p>
                                <div
                                    class="graph-canvas-wrapper"
                                    on:mousedown={(e) => handleMouseDown(e, 'integer')}
                                    role="button"
                                    tabindex="0"
                                >
                                    <DistributionGraph
                                        config={integerDistConfig}
                                        label="Integer Distribution"
                                        graphType="integer"
                                        width={600}
                                        height={300}
                                    />
                                </div>

                                <!-- Slider Controls -->
                                <div class="slider-controls">
                                    <p class="keyboard-hint">💡 Tip: Use arrow keys for fine control when slider is focused</p>
                                    <div class="slider-group">
                                        <label for="integer-center-slider">
                                            Center: {(integerDistConfig.center * 100).toFixed(1)}%
                                        </label>
                                        <input
                                            type="range"
                                            id="integer-center-slider"
                                            min="0"
                                            max="1"
                                            step="0.01"
                                            bind:value={integerDistConfig.center}
                                            class="distribution-slider"
                                        />
                                    </div>
                                    <div class="slider-group">
                                        <label for="integer-spread-slider">
                                            Spread: {(integerDistConfig.spread * 100).toFixed(1)}%
                                        </label>
                                        <input
                                            type="range"
                                            id="integer-spread-slider"
                                            min="0.05"
                                            max="0.5"
                                            step="0.01"
                                            bind:value={integerDistConfig.spread}
                                            class="distribution-slider"
                                        />
                                    </div>
                                </div>

                                <!-- Advanced Settings (T-Curve only) -->
                                {#if integerDistConfig.type === 't-curve'}
                                <details class="advanced-settings">
                                    <summary>⚙️ Advanced Settings</summary>
                                    <div class="slider-group">
                                        <label for="integer-df-slider">
                                            Degrees of Freedom: {integerDistConfig.degreesOfFreedom || 5}
                                            <span class="help-text">(lower = heavier tails)</span>
                                        </label>
                                        <input
                                            type="range"
                                            id="integer-df-slider"
                                            min="1"
                                            max="30"
                                            step="1"
                                            bind:value={integerDistConfig.degreesOfFreedom}
                                            class="distribution-slider"
                                        />
                                    </div>
                                </details>
                                {/if}

                                <!-- Sample Preview -->
                                <div class="sample-preview">
                                    <div class="preview-header">
                                        <span class="preview-title">Sample Preview:</span>
                                        <button
                                            class="preview-refresh-btn"
                                            on:click={() => integerSampleRefreshKey++}
                                        >
                                            ↻ Refresh
                                        </button>
                                    </div>
                                    <div class="preview-samples">
                                        {#key integerSampleRefreshKey + JSON.stringify(integerDistConfig)}
                                        {#each [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4] as digitCount}
                                            <span class="sample-value">
                                                {(() => {
                                                    // Apply distribution to each digit range independently
                                                    // 0% = min of range, 100% = max of range
                                                    const min = digitCount === 1 ? 0 : Math.pow(10, digitCount - 1);
                                                    const max = Math.pow(10, digitCount) - 1;
                                                    return generateConstrainedInteger(min, max, integerDistConfig);
                                                })()}
                                            </span>
                                        {/each}
                                        {/key}
                                    </div>
                                    <p class="preview-description">
                                        Sample integer specifiers (X, XX, XXX, XXXX)
                                    </p>
                                </div>

                                <button
                                    class="debug-button"
                                    on:click={() => debugDistribution(integerDistConfig, 0, 9999)}
                                >
                                    🐛 Debug Integer Distribution
                                </button>
                            </div>

                            <!-- Date Distribution Graph -->
                            <div class="graph-container" class:disabled={enableDateOverride}>
                                <h3>Date Distribution</h3>
                                {#if enableDateOverride}
                                    <p class="disabled-notice">⚠️ Disabled (Custom Date Override Active)</p>
                                {:else}
                                    <div class="distribution-selector">
                                        <label for="date-distribution-type">Distribution:</label>
                                        <select
                                            id="date-distribution-type"
                                            bind:value={dateDistConfig.type}
                                            on:change={() => { dateDistConfig = {...dateDistConfig}; }}
                                        >
                                            <option value="uniform">Uniform (Flat)</option>
                                            <option value="bell">Bell Curve (Normal)</option>
                                            <option value="z-curve">Z-Curve (Standard Normal)</option>
                                            <option value="t-curve">T-Curve (Heavy Tails)</option>
                                        </select>
                                        <span class="distribution-tooltip" title={
                                            dateDistConfig.type === 'uniform' ? '✨ All years equally likely across the range' :
                                            dateDistConfig.type === 'bell' ? '📊 Most dates near center, fewer at edges (classic bell shape)' :
                                            dateDistConfig.type === 'z-curve' ? '📊 Same as bell curve (standard normal distribution)' :
                                            '📈 Like bell curve but with more dates at the edges (heavy tails)'
                                        }>ⓘ</span>
                                    </div>

                                    <!-- Preset Buttons -->
                                    <div class="preset-buttons">
                                        <button
                                            class="preset-btn"
                                            on:click={() => {
                                                dateDistConfig = { ...dateDistConfig, center: 0.5, spread: 0.15 };
                                            }}
                                            title="Center-focused with tight spread"
                                        >
                                            🎯 Centered
                                        </button>
                                        <button
                                            class="preset-btn"
                                            on:click={() => {
                                                dateDistConfig = { ...dateDistConfig, center: 0.25, spread: 0.2 };
                                            }}
                                            title="Skewed towards older videos"
                                        >
                                            ⬅️ Older
                                        </button>
                                        <button
                                            class="preset-btn"
                                            on:click={() => {
                                                dateDistConfig = { ...dateDistConfig, center: 0.75, spread: 0.2 };
                                            }}
                                            title="Skewed towards newer videos"
                                        >
                                            ➡️ Newer
                                        </button>
                                        <button
                                            class="preset-btn"
                                            on:click={() => {
                                                dateDistConfig = { ...dateDistConfig, center: 0.5, spread: 0.4 };
                                            }}
                                            title="Wide spread across all years"
                                        >
                                            📊 Wide
                                        </button>
                                    </div>

                                    <p class="graph-description">Drag left/right to move center, up/down to adjust spread</p>
                                    <div
                                        class="graph-canvas-wrapper"
                                        on:mousedown={(e) => handleMouseDown(e, 'date')}
                                        role="button"
                                        tabindex="0"
                                    >
                                        <DistributionGraph
                                            config={dateDistConfig}
                                            label="Date Distribution"
                                            graphType="date"
                                            width={600}
                                            height={300}
                                            minDate={distributionStartDate}
                                            maxDate={distributionEndDate}
                                        />
                                    </div>

                                    <!-- Slider Controls -->
                                    <div class="slider-controls">
                                        <p class="keyboard-hint">💡 Tip: Use arrow keys for fine control when slider is focused</p>
                                        <div class="slider-group">
                                            <label for="date-center-slider">
                                                Center: {(dateDistConfig.center * 100).toFixed(1)}%
                                            </label>
                                            <input
                                                type="range"
                                                id="date-center-slider"
                                                min="0"
                                                max="1"
                                                step="0.01"
                                                bind:value={dateDistConfig.center}
                                                class="distribution-slider"
                                            />
                                        </div>
                                        <div class="slider-group">
                                            <label for="date-spread-slider">
                                                Spread: {(dateDistConfig.spread * 100).toFixed(1)}%
                                            </label>
                                            <input
                                                type="range"
                                                id="date-spread-slider"
                                                min="0.05"
                                                max="0.5"
                                                step="0.01"
                                                bind:value={dateDistConfig.spread}
                                                class="distribution-slider"
                                            />
                                        </div>
                                    </div>

                                    <!-- Advanced Settings (T-Curve only) -->
                                    {#if dateDistConfig.type === 't-curve'}
                                    <details class="advanced-settings">
                                        <summary>⚙️ Advanced Settings</summary>
                                        <div class="slider-group">
                                            <label for="date-df-slider">
                                                Degrees of Freedom: {dateDistConfig.degreesOfFreedom || 5}
                                                <span class="help-text">(lower = heavier tails)</span>
                                            </label>
                                            <input
                                                type="range"
                                                id="date-df-slider"
                                                min="1"
                                                max="30"
                                                step="1"
                                                bind:value={dateDistConfig.degreesOfFreedom}
                                                class="distribution-slider"
                                            />
                                        </div>
                                    </details>
                                    {/if}

                                    <!-- Sample Preview -->
                                    <div class="sample-preview">
                                        <div class="preview-header">
                                            <span class="preview-title">Sample Preview:</span>
                                            <button
                                                class="preview-refresh-btn"
                                                on:click={() => dateSampleRefreshKey++}
                                            >
                                                ↻ Refresh
                                            </button>
                                        </div>
                                        <div class="preview-samples">
                                            {#key dateSampleRefreshKey + JSON.stringify(dateDistConfig)}
                                            {#each [
                                                (d) => d.getFullYear().toString(),
                                                (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`,
                                                (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
                                                (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
                                                (d) => {
                                                    const h = d.getHours();
                                                    const m = String(d.getMinutes()).padStart(2, '0');
                                                    const s = String(d.getSeconds()).padStart(2, '0');
                                                    return `${h}:${m}:${s}`;
                                                },
                                                (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                                                (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`
                                            ] as formatter}
                                                <span class="sample-value">
                                                    {(() => {
                                                        const sampleDate = generateConstrainedDate(
                                                            new Date('2005-12-31'),
                                                            new Date(),
                                                            dateDistConfig
                                                        );
                                                        return formatter(sampleDate);
                                                    })()}
                                                </span>
                                            {/each}
                                            {/key}
                                        </div>
                                        <p class="preview-description">
                                            Sample date/time specifiers
                                        </p>
                                    </div>

                                    <button
                                        class="debug-button"
                                        on:click={() => {
                                            const startDate = new Date('2005-12-31');
                                            const today = new Date();
                                            const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                                            debugDistribution(dateDistConfig, 0, daysSinceStart);
                                        }}
                                    >
                                        🐛 Debug Date Distribution
                                    </button>
                                {/if}
                            </div>

                        </div>
                        {/if}

                    </div>
                </div>
                {/if}

                <!-- SEARCH HISTORY TAB -->
                {#if activeTab === 'history'}
                <div class="tab-panel">
                    <div class="history-section">
                        <div class="history-header">
                            <h3>Search History</h3>
                            <button class="refresh-button" on:click={clearSearchHistory} title="Clear search history">
                                ↻ Clear History
                            </button>
                        </div>
                        <p class="history-description">
                            {#if enablePersistentHistory}
                                Your search history is saved persistently via cookies
                            {:else}
                                Your search history is only saved for this session
                            {/if}
                        </p>

                        <div class="persistent-history-toggle">
                            <label class="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={enablePersistentHistory}
                                    on:change={togglePersistentHistory}
                                />
                                <span>Save search history across sessions (uses cookies)</span>
                            </label>
                        </div>

                        {#if searchHistory.length === 0}
                            <div class="empty-history">
                                <p>No searches yet. Click "Find Videos" to start!</p>
                            </div>
                        {:else}
                            <div class="search-history-list">
                                {#each searchHistory as entry, index}
                                    {@const formattedTime = entry.timestamp.toLocaleString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                        hour12: false
                                    })}
                                    <button
                                        class="history-item"
                                        class:even={index % 2 === 0}
                                        on:click={() => window.open(entry.url, '_blank')}
                                    >
                                        <div class="history-term">
                                            <span class="history-name">{entry.name}</span>
                                            <span class="history-specifier">{entry.specifier}</span>
                                            {#if entry.dateModifier}
                                                <span class="history-date-modifier">{entry.dateModifier}</span>
                                            {/if}
                                        </div>
                                        <div class="history-timestamp">{formattedTime}</div>
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>
                {/if}

                <!-- CUSTOM TERMS TAB -->
                {#if activeTab === 'custom'}
                <div class="tab-panel">
                    <div class="custom-terms-section">

                        <!-- Enable Custom Terms Checkbox -->
                        <div class="checkbox-item">
                            <input
                                type="checkbox"
                                id="enable-user-terms"
                                bind:checked={enableUserTerms}
                            />
                            <label for="enable-user-terms"><h4>Enable custom terms</h4></label>
                        </div>

                        {#if enableUserTerms}
                        <!-- Both Forms Side by Side -->
                        <div class="custom-terms-grid">
        <div class="custom-terms-creator">
            <h3>Create/Edit Search Terms</h3>

            <!-- Top Row: Save/Delete Buttons + Term Selector -->
            <div class="form-top-row">
                <div class="button-group">
                    <button class="custom-term-button save-button" on:click={saveSearchTerm}>
                        <h2>Save</h2>
                    </button>
                    <button class="custom-term-button delete-button" on:click={deleteCurrentTerm}>
                        <h2>Delete</h2>
                    </button>
                </div>

                <!-- Form Dropdown Menu -->
                <div class="term-selector">
                    <select bind:value={selectedTermIndex} on:change={(e) => {
                        const index = parseInt(e.currentTarget.value);
                        if (!isNaN(index) && index >= 0) {
                            loadTermIntoForm(index);
                        } else {
                            clearForm();
                        }
                    }}>
                        <option value="-1">
                            {JSON.parse(localStorage.getItem('customSearchTerms') || '[]').length === 0
                                ? 'No saved terms'
                                : 'Select a saved term...'}
                        </option>
                        {#each JSON.parse(localStorage.getItem('customSearchTerms') || '[]') as term, i}
                            <option value={i}>
                                {term.name} {term.specifiers.length > 0 ? `${term.specifiers[0]}` : ''}
                            </option>
                        {/each}
                    </select>
                </div>
            </div>

            <!-- Required Fields Section -->
            <div class="form-section">
                <div class="form-row">
                    <label for="custom-name">Search Term: (Space Sensitive)</label>
                    <input
                        type="text"
                        id="custom-name"
                        placeholder="i.e: IMG, MOV , My Epic Video, etc..."
                        bind:value={customName}
                    />
                </div>

                <div class="form-row">
                    <label for="custom-specifiers">Specifiers:</label>
                    <div class="specifier-container">
                        <div class="specifier-inputs">
                            {#each customSpecifiersList as _, i}
                                <input
                                    type="text"
                                    placeholder="i.e: XXXX, Month DD YYYY, YYYY/MM/DD, etc..."
                                    bind:value={customSpecifiersList[i]}
                                />
                            {/each}
                        </div>
                        <div class="specifier-control-bar">
                            <button
                                class="specifier-add-btn"
                                on:click={addSpecifierField}
                                type="button"
                                title="Add specifier field"
                            >
                                +
                            </button>
                            <button
                                class="specifier-remove-btn"
                                on:click={() => removeSpecifierField(customSpecifiersList.length - 1)}
                                type="button"
                                disabled={customSpecifiersList.length <= 1}
                                title="Remove last specifier field"
                            >
                                −
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- More Info Toggle -->
            <div class="more-info-toggle">
                <input
                    type="checkbox"
                    id="show-more-info"
                    bind:checked={showMoreInfo}
                />
                <label for="show-more-info">More info?</label>
            </div>

            {#if showMoreInfo}
            <!-- Optional Fields Section -->
            <div class="form-section">
                <div class="form-grid">
                    <div class="form-row optional">
                        <label for="custom-genre">Genre:</label>
                        <input
                            type="text"
                            id="custom-genre"
                            placeholder="Custom (default)"
                            bind:value={customGenre}
                        />
                    </div>

                    <div class="form-row optional">
                        <label for="custom-age">Age Filter:</label>
                        <select id="custom-age" bind:value={customAge}>
                            <option value="">Any (default)</option>
                            <option value="new">New</option>
                            <option value="old">Old</option>
                        </select>
                    </div>
                </div>

                <div class="form-grid">
                    <div class="form-row optional">
                        <label for="custom-constraint">Date Constraint:</label>
                        <select id="custom-constraint" bind:value={customConstraintType}>
                            <option value="none">None (default)</option>
                            <option value="before">Before</option>
                            <option value="after">After</option>
                            <option value="exact">Exact</option>
                        </select>
                    </div>

                    {#if customConstraintType !== 'none'}
                    <div class="form-row optional">
                        <label for="custom-constraint-date">Constraint Date:</label>
                        <input
                            type="date"
                            id="custom-constraint-date"
                            bind:value={customConstraintDate}
                        />
                    </div>
                    {/if}
                </div>
            </div>
            {/if}
        </div>

        <!-- Import/Export Manager -->
        <div class="import-export-container">
            <h3>Import/Export Custom Terms</h3>

            <!-- Export Section -->
            <div class="form-section">
                <button class="custom-term-button" on:click={exportCustomTerms}>
                    <h2>Export to File</h2>
                </button>
            </div>

            <!-- File Selection Section -->
            <div class="form-section">


                <!-- Drag & Drop Zone -->
                <div
                    class="file-drop-zone"
                    class:active={false}
                    on:dragover={handleDragOver}
                    on:drop={handleFileDrop}
                    role="button"
                    tabindex="0"
                >
                    <div class="drop-zone-content">
                        <p class="drop-zone-text">
                            {#if selectedFile}
                                ✓ Selected: <strong>{selectedFile.name}</strong>
                            {:else}
                                Drag & drop a JSON file here
                            {/if}
                        </p>
                        <p class="drop-zone-subtext">or</p>
                        <label class="file-select-button">
                            Choose File
                            <input
                                type="file"
                                accept=".json"
                                on:change={handleFileSelect}
                                style="display: none;"
                            />
                        </label>
                    </div>
                </div>
            </div>

            <!-- Import Options -->
            <div class="form-section">
                <div class="import-button-grid">
                    <button class="import-button" on:click={importSimple}>
                        <h2>Replace All</h2>
                        <p>Overwrites existing terms</p>
                    </button>

                    <button class="import-button" on:click={importMerge}>
                        <h2>Merge Duplicates</h2>
                        <p>Combines matching terms</p>
                    </button>
                </div>
            </div>

            <!-- Delete Section -->
            <div class="form-section">
                <button class="danger-button" on:click={deleteAllCustomTerms}>
                    <h2>Clear All Custom Terms</h2>
                </button>
            </div>

            <!-- Import Results Display -->
            {#if importStats}
            <div class="import-stats">
                <p>
                    ✓ <strong>{importStats.success}</strong> imported
                    {#if importStats.failed > 0}
                        · ✗ <strong>{importStats.failed}</strong> failed
                    {/if}
                </p>
            </div>
            {/if}
        </div>

        </div>
        {/if}

                    </div>
                </div>
                {/if}

                <!-- TERM LOOKUP TAB -->
                {#if activeTab === 'lookup'}
                <div class="tab-panel">
                    <div class="term-lookup-section">

                        <!-- Search and Filter Controls -->
                        <div class="term-lookup-controls">

                            <!-- Search Bar -->
                            <input
                                type="text"
                                placeholder="Search terms..."
                                bind:value={termLookupSearchQuery}
                                class="lookup-search-input"
                            />

                            <!-- Filters Row -->
                            <div class="lookup-filters-row">

                                <!-- Genre Filter -->
                                <div class="lookup-filter">
                                    <label for="lookup-genre-filter">Genre:</label>
                                    <select id="lookup-genre-filter" bind:value={termLookupGenreFilter}>
                                        <option value="all">All Genres</option>
                                        {#each allGenres as genre}
                                            <option value={genre}>{genre}</option>
                                        {/each}
                                    </select>
                                </div>

                                <!-- Age Filter -->
                                <div class="lookup-filter">
                                    <label for="lookup-age-filter">Age:</label>
                                    <select id="lookup-age-filter" bind:value={termLookupAgeFilter}>
                                        <option value="any">Any</option>
                                        <option value="new">New</option>
                                        <option value="old">Old</option>
                                    </select>
                                </div>

                                <!-- Sort Button -->
                                <div class="lookup-sort">
                                    <button
                                        class="lookup-sort-button"
                                        on:click={() => termLookupSortOrder = termLookupSortOrder === 'asc' ? 'desc' : 'asc'}
                                        title={termLookupSortOrder === 'asc' ? 'Sort Z-A' : 'Sort A-Z'}
                                    >
                                        Sort: {termLookupSortOrder === 'asc' ? 'A-Z' : 'Z-A'}
                                    </button>
                                </div>

                            </div>

                            <!-- Results Count -->
                            <div class="lookup-results-count">
                                Showing {lookupTermsList.length} terms
                            </div>

                        </div>

                        <!-- Terms List -->
                        <div class="term-lookup-list">
                            {#each lookupTermsList as item}
                                <div class="term-lookup-item-wrapper">
                                    <button
                                        class="term-lookup-item"
                                        class:expanded={selectedLookupTerm === item.displayKey}
                                        on:click={() => selectedLookupTerm = selectedLookupTerm === item.displayKey ? null : item.displayKey}
                                    >
                                        <span class="term-lookup-name">{item.name}</span>
                                        {#if item.showSpecifier}
                                            <span class="term-lookup-specifier">{item.specifier}</span>
                                        {/if}
                                    </button>

                                    {#if selectedLookupTerm === item.displayKey}
                                        {@const pattern = allSearchTerms.find(term =>
                                            term.name === item.name && term.specifiers.includes(item.specifier)
                                        )}
                                        {#if pattern}
                                            <div class="term-detail-box">
                                                <!-- Term Details -->
                                                <div class="term-detail-section">
                                                    <div class="term-detail-row">
                                                        <span class="term-detail-label">Name:</span>
                                                        <span class="term-detail-value">{pattern.name}</span>
                                                    </div>
                                                    <div class="term-detail-row">
                                                        <span class="term-detail-label">Specifier(s):</span>
                                                        <span class="term-detail-value">
                                                            {#if pattern.specifiers.length === 0 || (pattern.specifiers.length === 1 && pattern.specifiers[0] === '')}
                                                                None
                                                            {:else}
                                                                <div class="specifier-list">
                                                                    {#each pattern.specifiers as spec}
                                                                        {@const example = fillSpecifierTemplate(spec, pattern, new Date())}
                                                                        <div class="specifier-item">
                                                                            <span>{spec}</span>
                                                                            {#if example && example !== ''}
                                                                                <span class="specifier-example">(i.e: {example})</span>
                                                                            {/if}
                                                                        </div>
                                                                    {/each}
                                                                </div>
                                                            {/if}
                                                        </span>
                                                    </div>
                                                    <div class="term-detail-row">
                                                        <span class="term-detail-label">Genre:</span>
                                                        <span class="term-detail-value">{pattern.genre}</span>
                                                    </div>
                                                    <div class="term-detail-row">
                                                        <span class="term-detail-label">Age:</span>
                                                        <span class="term-detail-value">{pattern.age || 'Any'}</span>
                                                    </div>
                                                    {#if pattern.constraints && pattern.constraints.length > 0}
                                                        <div class="term-detail-row">
                                                            <span class="term-detail-label">Constraints:</span>
                                                            <span class="term-detail-value">
                                                                {#each pattern.constraints as constraint, i}
                                                                    {constraint.type}: {constraint.date}{i < pattern.constraints.length - 1 ? ', ' : ''}
                                                                {/each}
                                                            </span>
                                                        </div>
                                                    {:else}
                                                        <div class="term-detail-row">
                                                            <span class="term-detail-label">Constraints:</span>
                                                            <span class="term-detail-value">None</span>
                                                        </div>
                                                    {/if}
                                                </div>

                                                <!-- Previous Searches -->
                                                <div class="term-detail-section previous-searches">
                                                    <div class="term-detail-divider"></div>
                                                    <h4>Previous searches with this term:</h4>
                                                    {#if searchHistory.filter(entry => entry.name === pattern.name).length === 0}
                                                        <p class="no-history-text">No searches yet with this term.</p>
                                                    {:else}
                                                        {@const filteredHistory = searchHistory.filter(entry => entry.name === pattern.name)}
                                                        <div class="term-history-list">
                                                            {#each filteredHistory as entry}
                                                                {@const formattedTime = entry.timestamp.toLocaleString('en-US', {
                                                                    year: 'numeric',
                                                                    month: 'short',
                                                                    day: 'numeric',
                                                                    hour: '2-digit',
                                                                    minute: '2-digit',
                                                                    second: '2-digit',
                                                                    hour12: false
                                                                })}
                                                                <button
                                                                    class="term-history-item"
                                                                    on:click={() => window.open(entry.url, '_blank')}
                                                                    title="Click to open this search in YouTube"
                                                                >
                                                                    <div class="term-history-specifier">{entry.specifier}</div>
                                                                    <div class="term-history-timestamp">{formattedTime}</div>
                                                                </button>
                                                            {/each}
                                                        </div>
                                                    {/if}
                                                </div>
                                            </div>
                                        {/if}
                                    {/if}
                                </div>
                            {/each}

                            {#if lookupTermsList.length === 0}
                                <div class="term-lookup-empty">
                                    <p>No terms found matching your filters.</p>
                                </div>
                            {/if}
                        </div>

                    </div>
                </div>
                {/if}

            </div>
        </div>
        {/if}

    <!-- Custom Warning Modal for Disabling Persistent History -->
    {#if showDisableWarning}
        <div class="modal-overlay" on:click={cancelDisablePersistentHistory}>
            <div class="modal-content" on:click={(e) => e.stopPropagation()}>
                <div class="modal-header">
                    <h3>⚠️ Warning</h3>
                </div>
                <div class="modal-body">
                    <p>Disabling persistent history will clear all your saved search history.</p>
                    <p>Your searches will only be stored for this session.</p>
                    <p><strong>Are you sure you want to continue?</strong></p>
                </div>
                <div class="modal-footer">
                    <button class="modal-button modal-cancel" on:click={cancelDisablePersistentHistory}>
                        Cancel
                    </button>
                    <button class="modal-button modal-confirm" on:click={confirmDisablePersistentHistory}>
                        Yes, Disable
                    </button>
                </div>
            </div>
        </div>
    {/if}

</main>
