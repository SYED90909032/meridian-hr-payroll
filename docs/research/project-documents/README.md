# Meridian research and design documents
These are the source documents behind Meridian: the market research, the original blueprints, the integration notes and the diagrams. They are kept here so future work can be traced back to the research that shaped it. They are reference material only; the running code lives in `apps/` and `packages/`, and the decisions that were adopted are recorded in `docs/adr/` and `docs/SPEC.md`.
Start with **Conversation_Summary_and_Document_Guide.md**. It explains, turn by turn, what was asked, what each document contains and how the requirements changed.

## Reports
| File | What it is |
|---|---|
| `HR_Platforms_Research_Dossier.md` | Research dossier on Keka and 30 alternative HR and payroll platforms (features, pricing, users, sources). |
| `front_matter.md` | Front matter and introduction of the research dossier. |
| `Meridian__Blueprint_for_an_Open-Source_People_and_.md` | Blueprint v1: an open-source people and payroll platform. |
| `Meridian_Blueprint_v2_Features_and_Backend.md` | Blueprint v2: features and backend, the complete version. A later edited copy is at `docs/blueprint-v2.md`. |
| `p1.md` to `p6.md` | Blueprint v2 written in parts: p1 overview and first pages, p2 onboarding/offboarding onward, p3 performance and growth onward, p4 Google Workspace / Microsoft 365, p5 backend architecture, p6 provider stack and costs. |
| `Conversation_Summary_and_Document_Guide.md` | Guide to the conversation and to every document. |

## Integration and cost notes
| File | What it is |
|---|---|
| `google.md` | Integrating with an existing Google Workspace subscription. |
| `microsoft.md` | Integrating with an existing Microsoft 365 subscription. |
| `devices.md` | Integrating attendance devices. |
| `llm-mcp.md` | Connecting paid AI assistants without exposing employee data. |
| `infra-costs.md` | Infrastructure cost note. |

## Diagrams and tools
| File | What it is |
|---|---|
| `architecture.d2` / `architecture.png` | System architecture (D2 source and image). |
| `capability_map.mmd` / `capability_map.png` | Capability map (Mermaid source and image). |
| `payroll_pipeline.mmd` / `payroll_pipeline.png` | Payroll pipeline (Mermaid source and image). |
| `data_model.mmd` | Data model (Mermaid ER diagram). |
| `agent_mcp_flow.mmd` | AI assistant / MCP request flow (Mermaid sequence diagram). |
| `heatmap.py` / `heatmap.png` | Script and image for the platform feature heatmap. |
| `citetools.py` | Helper script used to check citations in the reports. |
| `pasted_content.txt` | The original written brief for the blueprint. |

Not included: an exact duplicate of the v1 blueprint whose file name contained a colon (invalid on Windows), and an unrelated tool instruction file.
