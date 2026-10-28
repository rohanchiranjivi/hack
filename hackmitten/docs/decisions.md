# Implementation decisions

- The workspace was empty, so the project is scaffolded as a Python API plus React/Vite client.
- Kept the first engine deterministic and dependency-light. It groups matching templates within a 15-minute window and shows the evidence that was used; no ground-truth labels enter correlation.
- Kept recommendations conservative and human-controlled. Export is local and explicitly not applied.
- Synthetic data is the default because no real data files were supplied.
- Advanced learned-model, streaming, robustness, B-Cubed/ARI, and top-k/time-to-surface work is left clearly marked as incomplete instead of inventing performance results.
