# FS-COD-1.0

FS-COD (Factor-Space-driven Co-recognition of Objects and Boundaries) is a
low-level image segmentation method that works without pre-trained models.

## Method overview

- **Factor space**: color, local contrast and texture observations are organized
  in a generic factor space.
- **Representation**: candidate regions are described by rule atoms and
  four-connected partitions.
- **Unified energy**: area-weighted factor deviations plus the length of true
  pixel boundaries.
- **Analysis phase**: region by region, the local phase state with the highest
  positive gain is selected for refinement.
- **Synthesis phase**: adjacent aggregation is restricted by regional
  differences.
- **Interpretability**: final labels, boundary states and attribute judgments
  are translated back into verifiable rules.
- **Calibration**: the training subset is used only to calibrate and freeze the
  global balance coefficient.

## Reported results (BSDS500, 200 test images)

| BF | PRI | VOI | COV | BDE | ARI |
|-------|-------|-------|-------|--------|-------|
| 0.479 | 0.789 | 2.532 | 0.495 | 11.044 | 0.428 |

- Image-wise win rate against five fixed-configuration classical baselines:
  74.5%–99.5%; all 30 paired tests p < 0.001 after Holm correction.
- Disabling synthesis: mean regions 125.0 → 639.9, BF drops to 0.401.
- Removing texture improves VOI at some cost to boundary and region matching.

## Limitations

Single-region degradation persists in the training and validation sets. Atomic
resolution, credential calibration, comparison with modern baselines and
cross-dataset generalization still require independent validation.
