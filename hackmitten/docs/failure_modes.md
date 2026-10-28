# Failure modes and historical bias

1. **Bias toward past patterns.** Historical co-occurrence reflects failures that were seen and linked before. A new failure mode, service, or topology change can be under-recognised. Use novelty review, keep confidence visible, and periodically review/retrain any future learned model.
2. **Survivorship in “never preceded an incident.”** Missing links do not mean safe. Rare events and weak monitoring coverage can leave dangerous signatures with no recorded incident. Require minimum evidence; otherwise send to review. Current prototype recommendations are explicitly conservative and synthetic.
3. **Dependency-map staleness.** Wrong or missing edges can cause bad merges or missed relationships. Validate the map and do not let graph evidence alone make a suppression decision.
4. **Over-merging and over-splitting.** Simultaneous independent incidents can merge; slow-burn incidents can split. The current template/time-window baseline does not yet quantify these error rates.
5. **Probable-origin misattribution.** Uneven instrumentation can make a silent upstream service appear healthy. Clock skew and monitoring lag also distort first-seen order. Origin is always labelled probable.
6. **Synthetic-to-production gap.** The generator and thresholds encode assumptions. Performance on real platform data may differ materially. No synthetic metric is a production guarantee.
7. **Feedback-loop risk.** If people inspect only surfaced situations, future training labels can miss demoted events. Audit a sample of lower-ranked items before learning from feedback.
8. **Optional LLM summary risk.** A model may hallucinate or follow hostile text embedded in an alert. Any future summarizer must receive redacted text, treat it as untrusted input, have no tools, and never drive actions. There is no LLM dependency now.
9. **Redaction limits.** Pattern matching can miss new identifier formats. Consistent pseudonyms remain linkable within the configured session salt.

Current engine limitations: it is a deterministic template/time-window baseline rather than the planned calibrated pairwise learner; the UI and report mark metrics that are not implemented. The service map and replay are demo visualizations, not a live monitoring integration.
