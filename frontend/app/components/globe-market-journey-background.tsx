export default function GlobeMarketJourneyBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#020B16]">
      <div className="journey-starfield" />

      <div className="journey-globe-stage absolute inset-0 flex items-center justify-center">
        <svg className="h-full w-full" viewBox="0 0 1600 1200" aria-hidden="true">
          <defs>
            <radialGradient id="journey-globe-ocean" cx="34%" cy="28%" r="70%">
              <stop offset="0%" stopColor="#82e3ff" />
              <stop offset="42%" stopColor="#2a94dd" />
              <stop offset="100%" stopColor="#0a376f" />
            </radialGradient>
            <radialGradient id="journey-globe-land" cx="35%" cy="28%" r="78%">
              <stop offset="0%" stopColor="#c9c2a1" />
              <stop offset="50%" stopColor="#7c7555" />
              <stop offset="100%" stopColor="#3e4333" />
            </radialGradient>
            <radialGradient id="journey-globe-atmo" cx="50%" cy="50%" r="50%">
              <stop offset="74%" stopColor="#5ce6ff" stopOpacity="0" />
              <stop offset="90%" stopColor="#5ce6ff" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#5ce6ff" stopOpacity="0.64" />
            </radialGradient>
            <radialGradient id="journey-globe-halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#38ccff" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#38ccff" stopOpacity="0" />
            </radialGradient>
            <clipPath id="journey-globe-clip">
              <circle cx="800" cy="600" r="352" />
            </clipPath>
          </defs>

          <circle cx="800" cy="600" r="446" fill="url(#journey-globe-halo)" />
          <circle cx="800" cy="600" r="352" fill="url(#journey-globe-ocean)" />

          <g clipPath="url(#journey-globe-clip)">
            <g className="journey-rotate-layer">
              <g fill="url(#journey-globe-land)" stroke="#efe6c7" strokeOpacity="0.12" strokeWidth="1.1">
                <path d="M548 372c16-18 36-30 60-34 21-3 40 1 56 13 17 12 28 30 31 51 3 22-3 42-17 59-13 15-30 28-48 38-26 15-41 31-49 51-8 21-8 45-1 71-14-9-28-24-39-43-14-24-22-53-22-84 0-47 11-88 29-122z" />
                <path d="M555 706c10-12 24-18 40-18 19 0 35 7 47 21 12 14 18 31 16 51-2 18-10 38-24 61-13 21-18 42-14 61 3 12 9 23 15 34-14 2-29-2-42-13-18-15-34-39-46-72-12-34-16-67-11-97 3-14 9-24 19-28z" />
                <path d="M760 334c12-10 28-15 47-14 19 1 34 8 45 21 12 13 16 29 14 47-2 17-10 31-22 42-14 12-30 18-47 18-20 0-36-7-47-20-11-12-15-28-14-47 1-18 9-34 24-47z" />
                <path d="M793 453c16-12 36-17 61-14 26 3 49 15 68 36 20 21 30 48 31 82 1 39-10 79-33 118-17 29-38 52-62 70-20 15-39 21-57 18-19-3-34-15-47-37-12-22-18-51-18-89 0-68 19-137 57-184z" />
                <path d="M894 474c12-8 27-10 43-5 17 5 28 16 33 33 4 16 1 30-10 42-10 11-24 16-41 14-16-2-28-11-35-24-7-14-6-28 1-40 2-4 5-8 9-10z" />
                <path d="M965 494c10-8 24-11 38-8 15 4 25 13 29 27 4 14 1 27-7 38-9 11-22 17-38 16-15-1-27-8-35-19-8-12-9-25-3-38 3-6 8-11 16-16z" />
              </g>

              <g transform="translate(710 0)">
                <g fill="url(#journey-globe-land)" stroke="#efe6c7" strokeOpacity="0.12" strokeWidth="1.1">
                  <path d="M548 372c16-18 36-30 60-34 21-3 40 1 56 13 17 12 28 30 31 51 3 22-3 42-17 59-13 15-30 28-48 38-26 15-41 31-49 51-8 21-8 45-1 71-14-9-28-24-39-43-14-24-22-53-22-84 0-47 11-88 29-122z" />
                  <path d="M555 706c10-12 24-18 40-18 19 0 35 7 47 21 12 14 18 31 16 51-2 18-10 38-24 61-13 21-18 42-14 61 3 12 9 23 15 34-14 2-29-2-42-13-18-15-34-39-46-72-12-34-16-67-11-97 3-14 9-24 19-28z" />
                  <path d="M760 334c12-10 28-15 47-14 19 1 34 8 45 21 12 13 16 29 14 47-2 17-10 31-22 42-14 12-30 18-47 18-20 0-36-7-47-20-11-12-15-28-14-47 1-18 9-34 24-47z" />
                  <path d="M793 453c16-12 36-17 61-14 26 3 49 15 68 36 20 21 30 48 31 82 1 39-10 79-33 118-17 29-38 52-62 70-20 15-39 21-57 18-19-3-34-15-47-37-12-22-18-51-18-89 0-68 19-137 57-184z" />
                  <path d="M894 474c12-8 27-10 43-5 17 5 28 16 33 33 4 16 1 30-10 42-10 11-24 16-41 14-16-2-28-11-35-24-7-14-6-28 1-40 2-4 5-8 9-10z" />
                  <path d="M965 494c10-8 24-11 38-8 15 4 25 13 29 27 4 14 1 27-7 38-9 11-22 17-38 16-15-1-27-8-35-19-8-12-9-25-3-38 3-6 8-11 16-16z" />
                </g>
              </g>

              <g fill="none" stroke="#f5c842" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.9">
                <path className="journey-route route-a" d="M586 534 C642 490 712 464 790 454 C842 447 882 454 922 468" />
                <path className="journey-route route-b" d="M560 484 C618 442 700 420 784 416 C850 414 902 424 950 444" />
                <path className="journey-route route-c" d="M836 410 C862 444 884 476 906 512 C920 536 930 562 932 590" />
                <path className="journey-route route-d" d="M542 602 C632 594 724 590 810 592 C884 594 944 602 998 614" />
                <path className="journey-route route-e" d="M560 640 C558 664 560 690 568 716 C574 736 582 754 590 774" />
                <path className="journey-route route-f" d="M804 458 C828 524 846 588 850 650 C853 698 846 740 832 780" />
              </g>

              <g fill="#9ff8ff">
                <circle cx="592" cy="534" r="4.5" />
                <circle cx="816" cy="420" r="4.5" />
                <circle cx="902" cy="466" r="4.5" />
                <circle cx="956" cy="524" r="4" />
                <circle cx="572" cy="642" r="4" />
                <circle cx="590" cy="774" r="4" />
                <circle cx="832" cy="780" r="4" />
              </g>
            </g>
          </g>

          <circle cx="800" cy="600" r="356" fill="url(#journey-globe-atmo)" />
        </svg>
      </div>

      <div className="journey-map-stage absolute inset-0 flex items-center justify-center px-4 md:px-8">
        <div className="journey-map-frame h-[82vh] w-full max-w-7xl rounded-[2.75rem] border border-cyan-300/25 bg-[#07192f]/88 p-4 md:p-6 shadow-[0_35px_140px_rgba(0,0,0,0.62)] backdrop-blur-md">
          <div className="relative h-full overflow-hidden rounded-[2.25rem] border border-cyan-300/20 bg-[radial-gradient(circle_at_35%_28%,rgba(28,94,149,0.65),rgba(8,25,47,0.94)_58%),linear-gradient(180deg,rgba(10,37,68,0.92),rgba(5,18,37,0.98))]">
            <div className="absolute inset-0 opacity-70" style={{
              backgroundImage:
                "linear-gradient(rgba(135,225,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(135,225,255,0.12) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
            }} />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(255,207,94,0.08),transparent_40%)]" />

            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1600 900" aria-hidden="true">
              <defs>
                <linearGradient id="journey-map-route" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#f5c842" stopOpacity="0.18" />
                  <stop offset="45%" stopColor="#fff1bf" stopOpacity="1" />
                  <stop offset="100%" stopColor="#f5c842" stopOpacity="0.18" />
                </linearGradient>
                <linearGradient id="journey-map-land" x1="0" y1="0" x2="0.8" y2="1">
                  <stop offset="0%" stopColor="#c7c09b" />
                  <stop offset="100%" stopColor="#5b5f47" />
                </linearGradient>
                <radialGradient id="journey-node-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#ffe9a1" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#ffe9a1" stopOpacity="0" />
                </radialGradient>
              </defs>

              <g fill="url(#journey-map-land)" opacity="0.96" stroke="#efe4bf" strokeOpacity="0.14" strokeWidth="1.6">
                <path d="M150 272c84-80 184-116 287-102 95 13 166 61 196 135 22 53 22 113 3 169-18 50-52 97-101 130-56 38-115 58-185 64-75 6-137-9-187-45-59-43-93-106-99-182-9-105 18-199 86-269z" />
                <path d="M347 600c52-27 106-33 154-18 56 19 98 62 113 116 14 48 7 103-19 158-25 57-59 103-102 135-37 29-76 42-114 38-39-5-73-29-98-70-28-43-39-95-34-158 6-66 37-139 100-201z" />
                <path d="M745 196c52-31 111-42 177-33 64 8 123 34 171 75 58 48 96 113 106 190 9 73-3 144-36 214-34 70-83 125-147 162-59 34-123 51-194 49-66-1-119-21-160-59-54-51-80-127-79-224 2-94 27-176 77-244 24-32 52-62 85-88z" />
                <path d="M1160 248c55-20 103-18 145 5 46 25 76 72 82 125 5 46-6 92-31 136-25 45-60 80-104 102-41 20-84 25-122 14-48-14-81-54-93-104-9-45 1-95 27-143 23-43 54-82 96-115z" />
              </g>

              <g fill="none" stroke="rgba(164,236,255,0.55)" strokeWidth="2.2">
                <path d="M225 315 L420 392 L518 526 L488 640 L399 771" />
                <path d="M780 238 L962 308 L1055 473 L1007 678 L849 804" />
                <path d="M1203 301 L1285 382 L1261 510" />
              </g>

              <g fill="none" stroke="url(#journey-map-route)" strokeWidth="5" strokeLinecap="round">
                <path className="journey-map-route map-route-a" d="M472 392 C602 352 706 327 838 320 C1014 311 1126 352 1260 404" />
                <path className="journey-map-route map-route-b" d="M392 748 C548 660 664 622 820 610 C1004 596 1118 632 1250 708" />
                <path className="journey-map-route map-route-c" d="M488 520 C624 528 718 544 830 582 C975 631 1074 690 1175 780" />
                <path className="journey-map-route map-route-d" d="M835 320 C886 390 924 462 955 540 C990 626 1017 696 1045 780" />
                <path className="journey-map-route map-route-e" d="M610 404 C700 430 784 470 862 525 C935 576 1014 636 1112 726" />
              </g>

              <g>
                <g fill="url(#journey-node-glow)" opacity="0.95">
                  <circle cx="472" cy="392" r="30" />
                  <circle cx="838" cy="320" r="34" />
                  <circle cx="1260" cy="404" r="28" />
                  <circle cx="392" cy="748" r="28" />
                  <circle cx="820" cy="610" r="34" />
                  <circle cx="1250" cy="708" r="28" />
                  <circle cx="488" cy="520" r="28" />
                  <circle cx="1045" cy="780" r="28" />
                </g>
                <g fill="#f5c842">
                  <circle cx="472" cy="392" r="7.5" />
                  <circle cx="838" cy="320" r="8" />
                  <circle cx="1260" cy="404" r="7" />
                  <circle cx="392" cy="748" r="7" />
                  <circle cx="820" cy="610" r="8" />
                  <circle cx="1250" cy="708" r="7" />
                  <circle cx="488" cy="520" r="7" />
                  <circle cx="1045" cy="780" r="7" />
                </g>
              </g>
            </svg>

            <div className="absolute left-8 top-8 rounded-2xl border border-cyan-300/20 bg-slate-950/70 px-5 py-4 text-white shadow-xl backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Route Activity</p>
              <p className="mt-1 text-2xl font-semibold">Live Freight Network</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-200">
                Deep-link view into active lanes, high-volume terminals, and market movement across connected freight corridors.
              </p>
            </div>

            <div className="absolute bottom-8 right-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-cyan-300/16 bg-slate-950/66 px-4 py-3 text-white shadow-lg backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-300">Open Corridors</p>
                <p className="mt-1 text-xl font-semibold">42</p>
              </div>
              <div className="rounded-2xl border border-cyan-300/16 bg-slate-950/66 px-4 py-3 text-white shadow-lg backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-300">Bid Activity</p>
                <p className="mt-1 text-xl font-semibold">1.2K</p>
              </div>
              <div className="rounded-2xl border border-cyan-300/16 bg-slate-950/66 px-4 py-3 text-white shadow-lg backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-300">Live Nodes</p>
                <p className="mt-1 text-xl font-semibold">87</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 bg-gradient-to-b from-[#020B16]/16 via-[#020B16]/52 to-[#020B16]/84" />
    </div>
  );
}


