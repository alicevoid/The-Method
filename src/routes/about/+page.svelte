<script lang="ts">
    import { base } from '$app/paths';
</script>

<style>

    .about-content {
        background-color: #f5f5f5;
        border: 0.5rem solid black;
        flex: 1;
        overflow-y: auto;
        box-sizing: border-box;
        padding: 2rem;
    }

    .about-section {
        max-width: 800px;
        margin: 0 auto;
        background-color: white;
        padding: 2rem;
        border: 3px solid black;
        border-radius: 0.5rem;
    }

    .about-section h2 {
        font-size: 1.75rem;
        margin-top: 0;
        margin-bottom: 1rem;
        color: black;
    }

    .about-section h3 {
        font-size: 1.25rem;
        margin-top: 1.5rem;
        margin-bottom: 0.75rem;
        color: black;
    }

    .about-section p {
        font-size: 1rem;
        line-height: 1.6;
        margin-bottom: 1rem;
    }

    .about-section a {
        color: white;
        text-decoration: none;
        font-weight: bold;
    }

    .about-section a:hover {
        text-decoration: underline;
    }

    .credit-box {
        background-color: lightcoral;
        padding: 1.5rem;
        border: 2px solid black;
        border-radius: 0.5rem;
        margin: 2rem 0;
        text-align: center;
    }

    .credit-box p {
        margin: 0.5rem 0;
        font-size: 1.1rem;
    }

    .youtube-link {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        background-color: red;
        color: white;
        padding: 0.75rem 1.5rem;
        border-radius: 0.25rem;
        text-decoration: none;
        font-weight: bold;
        margin-top: 1rem;
        transition: transform 0.2s ease;
    }

    .youtube-link:hover {
        transform: scale(1.01);
        text-decoration: none;
    }

    .youtube-link img {
        height: 2rem;
        width: 2rem;
        border-radius: 50%;
    }

    .rainbow-text {
        animation: hidden-rainbow-cycle 8s infinite;
    }

    @keyframes hidden-rainbow-cycle {
        0%, 82%, 100% {
            color: inherit;
        }
        84% {
            color: #fd2323;
        }
        86% {
            color: #ff5202;
        }
        88% {
            color: #e0ca03;
        }
        90% {
            color: #86da00;
        }
        92% {
            color: #00b193;
        }
        94% {
            color: #6600ec;
        }
        96% {
            color: #ff0055;
        }
        98% {
            color: #ff0000;
        }
    }

    @media (max-width: 768px) {
        .about-content {
            border-width: 0.25rem;
            padding: 1rem;
        }

        .about-section {
            padding: 1rem;
            border-width: 2px;
        }

        .about-section h2 {
            font-size: 1.25rem;
        }

        .about-section h3 {
            font-size: 1rem;
        }

        .about-section p {
            font-size: 0.9rem;
        }

        .credit-box {
            padding: 1rem;
        }

        .credit-box p {
            font-size: 0.9rem;
        }
    }
</style>

<main class="about-content">
    <div class="about-section">
        <h2>About This Project</h2>

        <h3>What Is This?</h3>
        <p>
            This site allows you to randomly search for YouTube videos in specific formats. These formats often result in videos uploaded en-masse from automated systems - which allows you to see a lot of random stuff you'd have a tough time finding otherwise.
        </p>

        <h3>Why I Made This</h3>
        <p>
            Mostly? I was bored.
        </p>
        <p>
            At this point I'm just adding <span class="rainbow-text">featurebloat</span> to see how far I can push it.
        </p>

        <div class="credit-box">
            <h3 style="margin-top: 0;">Where I Found the Terms</h3>
            <p>
                This whole thing is mostly inspired by YouTube channel <strong>KVNAUST</strong>'s series on Random YouTube Videos. When I saw they had a list of "Methods" to find obscure YouTube videos with zero views, I felt like it'd be fun to recreate the list as a site that let you easily find search results.
            </p>
            <p>
                A lot of this site is heavily inspired by their work - from the layout to the search terms I initially started working with.
            </p>
            <p style="margin-top: 1.5rem;">
                <strong>If you like this site, check out their channel:</strong>
            </p>
            <a href="https://www.youtube.com/KVNAUST" target="_blank" class="youtube-link">
                <img src="{base}/kvnaust.jpg" alt="KVN AUST"/>
                YouTube.com/KVNAUST
            </a>
        </div>

        <h3>Credits</h3>
        <p>
            Original "Method" list mapped by <a href="https://x.com/MingKasterMK/status/1965144635388653811/photo/1" target="_blank" style="color: black;">KVN AUST & Mika_Virus</a>
        </p>
        <p>
            Developed & Maintained by <strong>alicevoid</strong>. Make sure to be Nice to Yourself &lt;3
        </p>
        <p style="margin-top: 1.5rem; color: #666;">
            Last Updated: November 24, 2025
        </p>
    </div>
</main>