<script lang="ts">
    import { base } from '$app/paths';
    import { page } from '$app/stores';
</script>



<style>
    @font-face {
        font-family: 'Arial';
        src: url('/fonts/arial.woff2') format('woff2'),
             url('/fonts/arial.ttf') format('truetype');
        font-weight: normal;
        font-style: normal;
    }

    @font-face {
        font-family: 'Arial Narrow';
        src: url('/fonts/arialnarrow.woff2') format('woff2'),
             url('/fonts/arialnarrow.ttf') format('truetype');
        font-weight: normal;
        font-style: normal;
    }

    :global(html) {
        height: 100%;
    }

    :global(body) {
        background-color: white;
        margin: 0;
        padding: 0;
        font-family: 'Arial', sans-serif;
        min-height: 100%;
    }

    /* CSS Variables for repeated values */
    :root {
        --border-std: 2px solid black;
        --border-thick: 3px solid black;
        --border-medium: 0.5rem solid black;
        --radius-sm: 0.25rem;
        --radius-md: 0.5rem;
        --transition-std: 0.2s ease;
        --color-primary: lightcyan;
        --color-bg: #f5f5f5;
        --color-danger: #FF6B6B;
        --color-success: #90EE90;
    }

    .header-base {
        height: 5rem;
        border: 0.5rem solid black;
        border-bottom: 0;
        align-items: center;
        display: flex;
        padding: 0 1rem;
        flex-shrink: 0;
    }

    .header {
        background-color: lightcoral;
        justify-content: center;
    }
    
    .header-2 {
        background-color: lightblue;
        justify-content: flex-start;
        padding-left: 2rem;
        gap: 0;
    }

    .header-2 nav {
        display: flex;
        align-items: flex-end;
        gap: 0.25rem;
        height: 100%;
    }

    .tab-link {
        color: black;
        text-decoration: none;
        font-size: 1.25rem;
        font-weight: bold;
        padding: 0.75rem 1.5rem;
        background-color: rgba(255, 255, 255, 0.5);
        border: 2px solid black;
        border-bottom: none;
        border-radius: 0.5rem 0.5rem 0 0;
        transition: all var(--transition-std);
        display: inline-block;
        position: relative;
        margin-bottom: -2px;
    }

    .tab-link:hover {
        background-color: rgba(255, 255, 255, 0.8);
        /* transform: translateY(-2px); */
    }

    .tab-link.active {
        background-color: #f5f5f5;
        margin-bottom: -0.5rem;
        padding-bottom: calc(0.75rem + 0.5rem);
        z-index: 10;
    }

    .page-container {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        box-sizing: border-box;
    }

    /* Tablet/Medium Responsive Styles */
    @media (max-width: 960px) and (min-width: 769px) {
        .header-base {
            height: 4rem;
            border-width: 0.375rem;
            padding: 0.75rem;
        }

        .header h1 {
            font-size: 2rem;
        }

        .tab-link {
            font-size: 1rem;
            padding: 0.5rem 1rem;
        }

        .header-2 {
            padding-left: 1rem;
        }
    }

    /* Mobile Responsive Styles */
    @media (max-width: 768px) {
        .header-base {
            height: auto;
            min-height: auto;
            border-width: 0.25rem;
            padding: 0.5rem;
            flex-direction: column;
            gap: 0.25rem;
        }

        .header h1 {
            font-size: 0.7rem;
            margin: 0;
            text-align: center;
        }

        .header-2 {
            padding-left: 0.5rem;
        }

        .tab-link {
            font-size: 0.65rem;
            padding: 0.4rem 0.75rem;
        }

        .tab-link.active {
            margin-bottom: -0.25rem;
            padding-bottom: calc(0.4rem + 0.25rem);
        }
    }

    /* Extra small mobile devices */
    @media (max-width: 480px) {
        .header h1 {
            font-size: 0.6rem;
        }

        .tab-link {
            font-size: 0.55rem;
            padding: 0.3rem 0.6rem;
        }
    }

</style>

<div class="page-container">

    <!-- First Header -->
    <header class="header-base header">
        <h1>Youtube Recycle Bin: Find New, Old, and Forgotten Videos</h1>
    </header>

    <!-- Second Header -->
    <header class="header-base header-2">
        <nav>
            <a href="{base}/" class="tab-link" class:active={$page.url.pathname === base || $page.url.pathname === base + '/'}>Home</a>
            <a href="{base}/about" class="tab-link" class:active={$page.url.pathname === base + '/about'}>About</a>
        </nav>
    </header>

    <!-- Page Content -->
    <slot />
</div>