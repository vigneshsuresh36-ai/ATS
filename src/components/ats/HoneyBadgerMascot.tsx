"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { honeyBadgerMoodEventName, type HoneyBadgerMood } from "@/lib/honeyBadgerMood";

type Expression = "neutral" | "yawn" | HoneyBadgerMood;

export function HoneyBadgerMascot() {
  const [expression, setExpression] = useState<Expression>("neutral");
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let blinkTimer = 0;
    let blinkCloseTimer = 0;
    let idleTimer = 0;
    let expressionTimer = 0;

    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        setBlinking(true);
        blinkCloseTimer = window.setTimeout(() => setBlinking(false), 140);
        scheduleBlink();
      }, 3500 + Math.random() * 3500);
    };

    const scheduleYawn = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        setExpression((current) => current === "neutral" ? "yawn" : current);
        expressionTimer = window.setTimeout(() => {
          setExpression((current) => current === "yawn" ? "neutral" : current);
          scheduleYawn();
        }, 2300);
      }, 30_000);
    };

    const onActivity = () => {
      setExpression("neutral");
      window.clearTimeout(expressionTimer);
      scheduleYawn();
    };

    const onMood = (event: Event) => {
      const mood = (event as CustomEvent<HoneyBadgerMood>).detail;
      if (mood !== "smile" && mood !== "sad") return;
      setExpression(mood);
      window.clearTimeout(expressionTimer);
      scheduleYawn();
      expressionTimer = window.setTimeout(() => setExpression("neutral"), 1800);
    };

    if (!reducedMotion.matches) scheduleBlink();
    scheduleYawn();
    const moodEvent = honeyBadgerMoodEventName();
    window.addEventListener(moodEvent, onMood);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("scroll", onActivity, { passive: true });
    window.addEventListener("touchstart", onActivity, { passive: true });

    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(blinkCloseTimer);
      window.clearTimeout(idleTimer);
      window.clearTimeout(expressionTimer);
      window.removeEventListener(moodEvent, onMood);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("scroll", onActivity);
      window.removeEventListener("touchstart", onActivity);
    };
  }, []);

  return (
    <span className={`hb-mascot${expression !== "neutral" ? ` is-${expression}` : ""}${blinking ? " is-blinking" : ""}`} aria-hidden="true">
      <Image className="hb-mascot-source" src="/honeybadger-light-transparent.png" width={1850} height={520} unoptimized alt="" />
      <span className="hb-mascot-face">
        <i className="hb-mascot-lid hb-mascot-lid-left" />
        <i className="hb-mascot-lid hb-mascot-lid-right" />
        <i className="hb-mascot-mouth"><i /></i>
      </span>
    </span>
  );
}