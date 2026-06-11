"use client";

import { useEffect } from "react";
import { startAuthInactivityWatcher } from "@/lib/auth-lite";

export default function AuthInactivityWatcher() {
  useEffect(() => {
    const stopWatcher = startAuthInactivityWatcher();
    return () => {
      stopWatcher();
    };
  }, []);

  return null;
}
