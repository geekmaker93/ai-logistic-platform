export default function GlobeMarketJourneyBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#020B16]">
      <div className="journey-starfield" />

      <div className="journey-globe-stage absolute inset-0 flex items-center justify-center">
        <div className="journey-textured-globe" aria-hidden="true">
          <span className="journey-globe-star journey-globe-star-a" />
          <span className="journey-globe-star journey-globe-star-b" />
          <span className="journey-globe-star journey-globe-star-c" />
          <span className="journey-globe-star journey-globe-star-d" />
          <span className="journey-globe-star journey-globe-star-e" />
          <span className="journey-globe-star journey-globe-star-f" />
          <span className="journey-globe-star journey-globe-star-g" />
        </div>
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

      <div className="absolute inset-0 bg-gradient-to-b from-[#020B16]/16 via-[#020B16]/52 to-[#020B16]/84" />
    </div>
  );
}


