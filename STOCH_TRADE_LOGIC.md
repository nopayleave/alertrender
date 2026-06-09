# Stochastic Trade Logic

## Core Framework

The entire trading method is built on the Stochastic oscillator read across two timeframes. The **2-minute** chart defines the market's overall momentum direction. The **30-second** chart provides precise execution timing within that direction.

| Timeframe | Role | What It Tells You |
|-----------|------|-------------------|
| **2m** | Momentum / Bias | Which side of the market you should be on |
| **30s** | Execution / Trigger | When to pull the trigger on entries and exits |

The 2m sets the context; the 30s operates inside that context. Never let the 30s override the 2m bias without good reason.

---

## Stochastic Levels

The stochastic oscillator (0–100) is divided into three functional zones. Each zone tells you something different about what participants are doing.

```
100 ─────────────────────────────
 90 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈  ← Extreme upper band
 80 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈  ← Upper extreme boundary
     ┊                          ┊
     ┊    EXTREME OVERBOUGHT    ┊  80–100 zone
     ┊    (Magnet / Trend)      ┊
     ┊                          ┊
 60 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ← Confirmation level (bull continue)
     ┊                          ┊
 50 ═══════════════════════════════ ← Bull / Bear dividing line
     ┊                          ┊
 40 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ← Confirmation level (bear continue)
     ┊                          ┊
     ┊    EXTREME OVERSOLD      ┊  0–20 zone
     ┊    (Magnet / Trend)      ┊
     ┊                          ┊
 20 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈  ← Lower extreme boundary
 10 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈  ← Extreme lower band
  0 ─────────────────────────────
```

### Confirmation Zone: 40 / 50 / 60

These three levels act as a bias filter.

| Condition | Read |
|-----------|------|
| Stoch **above 50** | Bullish bias — look for longs |
| Stoch **below 50** | Bearish bias — look for shorts |
| Bounce **above 60** | Bull continuation confirmed — momentum still has legs |
| Rejection **below 40** | Bear continuation confirmed — sellers still in control |

The 50 line is the battlefield. Whichever side holds it dictates the session's direction.

### Extreme Zones: 10–20 and 80–90

The extremes act as **magnets**. Once stochastic enters 80–90 or 10–20, it tends to get pulled deeper before reversing. The behaviour at these levels reveals the real character of the day's trend.

| Behaviour | Interpretation |
|-----------|----------------|
| Stoch bounces off 20 and recovers | Not that bearish — sellers failed to hold |
| Stoch **drags under 20**, stays or slides below 10 | Real bearish trend of the day — sellers are in full control |
| Stoch bounces off 80 and pulls back | Not that bullish — buyers failed to hold |
| Stoch **drags above 80**, stays or pushes above 90 | Real bullish trend of the day — buyers are in full control |

**Key distinction:** A touch of the extreme is a test. A *dwell* in the extreme is a verdict. When the stochastic is dragged into and held inside the extreme zone, that is the market telling you the trend is real, not a fakeout.

---

## Higher Highs and Lower Lows — The Foundation

This is the single most important concept underlying the entire method.

### The Logic

All price action reduces to a sequence of peaks and troughs. Here is the reasoning:

1. **The first peak (or bottom) establishes a benchmark.** It tells the market: "This is what participants valued at the extreme." It is a reference point — the first offer of what something is worth at a high or a low.

2. **The second peak (or bottom) is a verdict.** If the market fails to reach the previous peak (a lower high) or fails to reach the previous trough (a higher low), it means participants are **denying the previous valuation**. The crowd is saying: "We don't believe the price belongs there anymore."

3. **The trend is the aftermath.** Once the market denies a valuation, the move that follows is mechanical: a **chain reaction of stop losses being triggered and short covers / long covers being forced**. The trend feeds on itself.

```
    HIGHER LOW (Bullish Structure)
    ──────────────────────────────

    Peak A
      ╱╲
     ╱  ╲          Peak B (higher high possible, or equal)
    ╱    ╲          ╱╲
           ╲       ╱  ╲
            ╲     ╱    ╲
    Trough A ╲   ╱      ╲ ...
              ╲ ╱
         Trough B (HIGHER than A)
              ↑
              Market denied the previous low →
              Bears' stops get swept →
              Trend accelerates up


    LOWER HIGH (Bearish Structure)
    ──────────────────────────────

    Peak A
      ╱╲
     ╱  ╲
    ╱    ╲
           ╲      Peak B (LOWER than A)
            ╲      ╱╲
             ╲    ╱  ╲
              ╲  ╱    ╲ ...
               ╲╱
           Trough A
                  ↑
                  Market denied the previous high →
                  Bulls' stops get swept →
                  Trend accelerates down
```

### Why This Matters for Stochastic

When the stochastic prints a higher low or lower high on either timeframe, the same logic applies:

- **Stoch higher low on 2m**: Momentum buyers are stepping in earlier than last time — bullish.
- **Stoch lower high on 2m**: Momentum sellers are stepping in earlier than last time — bearish.
- **Stoch higher low on 30s**: Entry-level confirmation of strengthening bid — time to execute long.
- **Stoch lower high on 30s**: Entry-level confirmation of weakening bid — time to execute short.

The stochastic is just another lens on the same supply-and-demand mechanics that drive price structure.

---

## Putting It Together: The Decision Flow

### Step 1 — Determine 2m Bias

Read the 2-minute stochastic for overall momentum direction.

| 2m Stoch Condition | Bias |
|--------------------|------|
| Above 50, holding or rising | **Bullish** — look for longs |
| Below 50, holding or falling | **Bearish** — look for shorts |
| Bouncing above 60 | **Bull continuation** — trend still strong |
| Rejecting below 40 | **Bear continuation** — trend still strong |
| Dragged under 20 / below 10 | **Strong bear day** — short bias, no longs |
| Dragged above 80 / above 90 | **Strong bull day** — long bias, no shorts |
| Bounces off 20, recovers above | Not that bearish — wait or look for reversal long |
| Bounces off 80, pulls back | Not that bullish — wait or look for reversal short |

### Step 2 — Read 30s for Execution

Once the 2m bias is set, switch to the 30-second chart for timing.

| 30s Stoch Condition | Action |
|---------------------|--------|
| 30s pulls back to oversold and prints **higher low** (2m bias bull) | **Enter long** |
| 30s rallies to overbought and prints **lower high** (2m bias bear) | **Enter short** |
| 30s crosses above 50 (2m bias bull) | Confirms long entry / add |
| 30s crosses below 50 (2m bias bear) | Confirms short entry / add |
| 30s bounces above 60 (2m bias bull) | Continuation — hold or trail |
| 30s rejects below 40 (2m bias bear) | Continuation — hold or trail |

### Step 3 — Validate with Structure

Before committing to any trade, check for higher-low / lower-high structure on both timeframes.

| Check | Pass | Fail |
|-------|------|------|
| 2m printing higher lows? | Confirms uptrend — proceed long | Uptrend weakening — caution |
| 2m printing lower highs? | Confirms downtrend — proceed short | Downtrend weakening — caution |
| 30s higher low within 2m uptrend? | High-confidence long entry | Possible divergence — wait |
| 30s lower high within 2m downtrend? | High-confidence short entry | Possible divergence — wait |

---

## Scenario Playbook

### Scenario 1 — Strong Bull Day
- **2m**: Stoch above 80, dragged into 80–90+. Holding above 60 on pullbacks.
- **30s**: Each pullback prints higher lows. 30s bounces above 60 repeatedly.
- **Action**: Buy every 30s pullback to oversold. Trail stops. Do not short.

### Scenario 2 — Strong Bear Day
- **2m**: Stoch below 20, dragged under 10. Failing to reclaim 40 on bounces.
- **30s**: Each bounce prints lower highs. 30s rejects below 40 repeatedly.
- **Action**: Short every 30s rally to overbought. Trail stops. Do not buy.

### Scenario 3 — Bull Bounce (Not Committed)
- **2m**: Stoch touches 20 but bounces quickly back above. Reclaims 40–50.
- **30s**: Prints higher lows after the bounce.
- **Action**: Tentative long. Not a full-conviction bull day, but the bounce off 20 says sellers couldn't hold. Tighter stops, smaller size.

### Scenario 4 — Bear Bounce (Not Committed)
- **2m**: Stoch touches 80 but pulls back quickly. Fails at 60.
- **30s**: Prints lower highs after the rejection.
- **Action**: Tentative short. Buyers couldn't hold 80. Tighter stops, smaller size.

### Scenario 5 — Trend Reversal via Structure Break
- **2m**: Was bullish (above 50, higher lows), but now prints a **lower high** below the previous peak.
- **30s**: Confirms with its own lower high or fails to reclaim 50.
- **Action**: Bias flips. Close longs, begin looking for shorts on 30s rallies.

---

## Rules Summary

1. **2m sets the direction. 30s sets the timing.** Never fight the 2m.
2. **Above 50 = bull. Below 50 = bear.** This is the simplest filter and the most reliable.
3. **60 bounce = bull continues. 40 rejection = bear continues.** These confirmations keep you on the right side.
4. **Extremes are magnets.** A visit to 80–90 or 10–20 pulls price deeper. A *bounce* off the extreme means the trend is questionable. A *dwell* in the extreme means the trend is real.
5. **Higher low = bullish. Lower high = bearish.** This is the foundation of all price action — the first peak or trough sets the benchmark, the second denies or confirms it, and the chain of stops does the rest.
6. **Align both timeframes.** The highest-probability trades happen when 2m bias and 30s execution point in the same direction.
