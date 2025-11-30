<!--
    ============================================================================
    DISTRIBUTION GRAPH COMPONENT
    ============================================================================
    Beautiful canvas-based visualization for probability distributions.

    TODO: CUSTOM THEMING SYSTEM - This color scheme is FIRE! 🔥
    When we implement site-wide custom theming, this component should:
    - Accept theme colors as props (background, primary, grid, text)
    - Support multiple color schemes (current off-white/red is gorgeous!)
    - Allow users to customize their graph aesthetics
    ============================================================================
-->
<script lang="ts">
    import { onMount, afterUpdate } from 'svelte';
    import type { DistributionConfig } from '../randomness';
    import { generatePDFCurve } from '../distributionPDF';

    // ========================================================================
    // PROPS - Configuration from parent component (+page.svelte)
    // ========================================================================
    export let config: DistributionConfig;      // The distribution settings (type, center, spread)
    export let label: string;                   // Graph title
    export let graphType: 'integer' | 'date' = 'integer';  // Which graph is this?

    // For date graphs: need to know the date range for labels
    export let minDate: Date | null = null;     // Start date (2005-12-31)
    export let maxDate: Date | null = null;     // End date (today)

    // ========================================================================
    // STATE - Internal tracking
    // ========================================================================
    let canvas: HTMLCanvasElement;              // Reference to the <canvas> element
    let containerElement: HTMLDivElement;       // Reference to the container div
    let animationFrameId: number | null = null; // For smooth animations
    let lastConfigString = '';                  // Track changes to avoid unnecessary redraws
    let width: number = 600;                    // Dynamic canvas width (responsive)
    let height: number = 300;                   // Dynamic canvas height (responsive)
    let resizeObserver: ResizeObserver | null = null; // Watches container size changes

    /**
     * ====================================================================
     * CRUCIAL FUNCTION: Main drawing routine
     * ====================================================================
     * This is called whenever the config changes (type, center, or spread)
     * It orchestrates all the drawing steps in order
     */
    function drawGraph() {
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // HIGH DPI SUPPORT: Make canvas sharp on retina displays
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // STEP 1: Clear old drawing
        ctx.clearRect(0, 0, width, height);

        // STEP 2: Generate curve data (THIS IS THE KEY!)
        // Calls distributionPDF.ts to get array of heights
        const pointCount = graphType === 'integer' ? 101 : 200;
        const curveData = generatePDFCurve(config, pointCount);

        // STEP 3: Draw in layers (bottom to top)
        ctx.fillStyle = '#f5f5f0';           // 1. Off-white background
        ctx.fillRect(0, 0, width, height);

        drawGrid(ctx);                        // 2. Grid lines
        drawCurve(ctx, curveData);           // 3. The curve itself (red gradient)
        drawCenterMarker(ctx);               // 4. Center line (dashed red)
        drawLabels(ctx);                     // 5. Axis labels (0%, 25%, etc.)
    }

    /**
     * Draws grid lines for visual reference
     */
    function drawGrid(ctx: CanvasRenderingContext2D) {
        ctx.strokeStyle = '#d0d0c8'; // Light gray grid on off-white
        ctx.lineWidth = 1;

        // Vertical grid lines (every 10%)
        for (let i = 0; i <= 10; i++) {
            const x = (i / 10) * width;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Horizontal grid lines
        for (let i = 0; i <= 4; i++) {
            const y = (i / 4) * height;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    }

    /**
     * Draws the probability distribution curve
     */
    function drawCurve(ctx: CanvasRenderingContext2D, data: number[]) {
        const pointCount = data.length;
        const padding = 20;
        const graphHeight = height - padding * 2;
        const graphWidth = width - padding * 2;

        ctx.beginPath();
        ctx.moveTo(padding, height - padding);

        // Draw the curve path
        for (let i = 0; i < pointCount; i++) {
            const x = padding + (i / (pointCount - 1)) * graphWidth;
            const y = height - padding - (data[i] * graphHeight);
            ctx.lineTo(x, y);
        }

        // Complete the filled area
        ctx.lineTo(width - padding, height - padding);
        ctx.closePath();

        // Fill the area under the curve
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(220, 38, 38, 0.3)'); // Translucent red top
        gradient.addColorStop(1, 'rgba(220, 38, 38, 0.1)'); // Translucent red bottom
        ctx.fillStyle = gradient;
        ctx.fill();

        // Stroke the curve line
        ctx.strokeStyle = 'rgba(220, 38, 38, 0.8)'; // Translucent red
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    /**
     * Draws a vertical line at the center position
     */
    function drawCenterMarker(ctx: CanvasRenderingContext2D) {
        const padding = 20;
        const graphWidth = width - padding * 2;
        const x = padding + config.center * graphWidth;

        ctx.strokeStyle = 'rgba(220, 38, 38, 0.8)'; // Translucent red
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);

        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.stroke();

        ctx.setLineDash([]); // Reset dash

        // Draw center label
        ctx.fillStyle = 'rgba(220, 38, 38, 0.9)';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';

        let centerLabel = '';
        if (graphType === 'integer') {
            centerLabel = `${(config.center * 100).toFixed(0)}%`;
        } else if (minDate && maxDate) {
            const range = maxDate.getTime() - minDate.getTime();
            const centerTime = minDate.getTime() + (config.center * range);
            const centerDate = new Date(centerTime);
            centerLabel = centerDate.getFullYear().toString();
        }

        ctx.fillText(centerLabel, x, padding - 5);
    }

    /**
     * Draws axis labels
     */
    function drawLabels(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = '#333333'; // Dark gray text on off-white
        ctx.font = '11px monospace';

        if (graphType === 'integer') {
            // X-axis labels for integer graph
            const labels = ['0%', '25%', '50%', '75%', '100%'];
            for (let i = 0; i < labels.length; i++) {
                const x = (i / 4) * width;

                // Align edge labels to prevent cutoff
                if (i === 0) {
                    ctx.textAlign = 'left';
                } else if (i === labels.length - 1) {
                    ctx.textAlign = 'right';
                } else {
                    ctx.textAlign = 'center';
                }

                ctx.fillText(labels[i], x, height - 5);
            }
        } else if (minDate && maxDate) {
            // X-axis labels for date graph (years)
            const startYear = minDate.getFullYear();
            const endYear = maxDate.getFullYear();
            const yearRange = endYear - startYear;
            const labelCount = Math.min(5, yearRange + 1);

            for (let i = 0; i < labelCount; i++) {
                const year = startYear + Math.floor((i / (labelCount - 1)) * yearRange);
                const x = (i / (labelCount - 1)) * width;

                // Align edge labels to prevent cutoff
                if (i === 0) {
                    ctx.textAlign = 'left';
                } else if (i === labelCount - 1) {
                    ctx.textAlign = 'right';
                } else {
                    ctx.textAlign = 'center';
                }

                ctx.fillText(year.toString(), x, height - 5);
            }
        }
    }

    /**
     * ====================================================================
     * PERFORMANCE OPTIMIZATION: Smart redrawing
     * ====================================================================
     * Only redraw if config actually changed, and use requestAnimationFrame
     * for smooth 60fps updates
     */
    function scheduleRedraw() {
        // SKIP if nothing changed (compare JSON strings)
        const configString = JSON.stringify(config);
        if (configString === lastConfigString) {
            return;
        }
        lastConfigString = configString;

        // CANCEL any pending redraw (prevents stacking)
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
        }

        // SCHEDULE redraw on next browser paint (60fps sync)
        animationFrameId = requestAnimationFrame(() => {
            drawGraph();
            animationFrameId = null;
        });
    }

    // ====================================================================
    // SVELTE REACTIVITY: Auto-redraw when config changes
    // ====================================================================
    // This is the magic! When you move a slider or drag the canvas,
    // config changes → this triggers → scheduleRedraw() → drawGraph()
    $: if (canvas && config) {
        scheduleRedraw();
    }

    // Initial draw and setup resize observer
    onMount(() => {
        // Set up ResizeObserver to watch container size changes
        resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Get actual rendered width of container
                const containerWidth = entry.contentRect.width;

                // Update dimensions maintaining 2:1 aspect ratio
                if (containerWidth > 0) {
                    width = Math.floor(containerWidth);
                    height = Math.floor(containerWidth / 2);

                    // Redraw with new dimensions
                    drawGraph();
                }
            }
        });

        // Start observing the container
        if (containerElement) {
            resizeObserver.observe(containerElement);
        }

        // Initial draw
        drawGraph();

        // Cleanup on component destroy
        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
        };
    });

    // Redraw on updates
    afterUpdate(() => {
        if (canvas) {
            scheduleRedraw();
        }
    });
</script>

<div class="distribution-graph" bind:this={containerElement}>
    <canvas
        bind:this={canvas}
        class="graph-canvas"
    />
</div>

<style>
    .distribution-graph {
        position: relative;
        display: block;
        width: 100%;
    }

    .graph-canvas {
        display: block;
        width: 100%;
        max-width: 100%;
        height: auto;
        aspect-ratio: 2 / 1;
        border-radius: 4px;
        cursor: grab;
        transition: opacity 0.15s ease-in-out;
    }

    .graph-canvas:active {
        cursor: grabbing;
    }

    /* Subtle fade-in animation on mount */
    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    .distribution-graph {
        animation: fadeIn 0.3s ease-in-out;
    }
</style>
