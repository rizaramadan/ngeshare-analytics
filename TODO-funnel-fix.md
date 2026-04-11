# Funnel Fix: Health Metrics Inconsistency

## Where We Are

### Finding: First Member-to-Facilitator
- **Tanti Diniyanti** is the first real facilitator whose member became a facilitator
- **Vivi Elvirita** (58 attendance records) became facilitator on 2025-07-29
- Nova Nurbaiti (0 attendance) and Trisna/Aghnia/Chakras are test accounts — ignore them

### Finding: Funnel Formula Inconsistency
The funnel page (`src/web/public/funnel.html` + `src/web/queries/funnel.js`) has a unit mismatch:

- **Conversion rates** (arrows between stages) use **facilitator counts** — correct
- **Health summary** (top cards) uses **group counts** — misleading

#### The Problem
Health metrics divide stage-4 groups by stage-1 groups:
- Completion Rate = 24 graduated groups / 284 stage-1 groups = 8.5%
- Retention Rate = 29 stage-4 groups / 284 stage-1 groups = 10.2%

But 284 groups ≠ 284 pipelines. One facilitator can run multiple groups at the same stage (one has 8 Aqidah groups). The denominator is inflated.

#### Facilitator-based numbers (more accurate)
| Stage | Facilitators |
|-------|-------------|
| Aqidah | 181 |
| Hijrah | 68 |
| Sejarah | 48 |
| Dakwah | 25 |

Facilitator-based completion would be ~13.8% (25/181), not 8.5%.

## Next Steps

1. **Decide**: Should health metrics use facilitator counts or group counts?
   - Facilitator counts align with how conversion rates already work
   - Group counts might still be useful as a secondary metric

2. **Fix `getFunnelHealth()` in `src/web/queries/funnel.js`** (lines 207-264):
   - Change `stage_1_groups` / `stage_4_groups` / `graduated_stage_4` CTEs to count distinct facilitators instead of groups
   - Or add both: facilitator-based as primary, group-based as secondary

3. **Update `renderFunnelHealth()` in `src/web/public/funnel.html`** (lines 166-198):
   - Update labels to reflect what's being measured (e.g., "Facilitators Started" vs "Groups Started")

## Files Involved
- `src/web/queries/funnel.js` — backend queries
- `src/web/public/funnel.html` — frontend rendering
- Views used: `v_group_status`, `v_group_progress`
