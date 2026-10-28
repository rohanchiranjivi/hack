"""Explainable alert ranking; deterministic weighted baseline, not a trained model."""

SEVERITY_WEIGHT={"info":0.18,"warning":0.36,"error":0.68,"critical":1.0}

def score_group(alerts, service_count: int, recognized_pattern: bool):
    """Return a risk score and tier while enforcing the prototype recall guard."""
    peak=max((a.get("severity","warning") for a in alerts),key=lambda x:["info","warning","error","critical"].index(x))
    visible=any(a.get("source") in ("uptime","status_page") for a in alerts)
    blast=min(service_count/8,1.0)
    precursor=1.0 if recognized_pattern else 0.0
    customer_signal=1.0 if visible else 0.0
    score=round(min(1.0,.52*SEVERITY_WEIGHT[peak]+.18*blast+.20*precursor+.10*customer_signal),3)
    # Hard safety floors sit above the score: score can rank, never hide these.
    if peak=="critical": tier="P1"
    elif visible or recognized_pattern: tier="P2"
    elif peak=="error" or (peak=="warning" and service_count>1): tier="P3"
    else: tier="P4"
    reasons=[f"Peak severity contributes {SEVERITY_WEIGHT[peak]:.2f}",f"Blast radius covers {service_count} service(s)"]
    if recognized_pattern: reasons.append("Known incident-like pattern raises the recall-guard score")
    if visible: reasons.append("Customer-visible uptime/status signal raises priority")
    return score,tier,reasons
