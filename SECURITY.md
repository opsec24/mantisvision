# Security Policy & Responsible Disclosure

## 1. Important Legal & Operational Disclaimer

> [!CAUTION]
> **DO NOT RUN AGAINST PRODUCTION SYSTEMS WITHOUT EXPLICIT WRITTEN AUTHORIZATION.**
> MantisVision is an offensive-defensive cognitive security audit and dynamic exploit synthesis platform. It is capable of synthesizing standalone functional proof-of-concept scripts (`reproducer.py`) to verify exploitative conditions. 
> 
> * **Authorized Targets Only**: Use MantisVision solely on codebases, repositories, and applications that you own or have explicit, documented authorization to test.
> * **Sandbox Isolation**: Always enforce sandboxed execution (`gvisor`, `microsandbox`, or `static-only`) when auditing untrusted third-party code.
> * **No Warranty / AS-IS**: This software is provided "AS-IS", without warranty or guarantee of any kind, either express or implied, including fitness for a particular purpose. In no event shall the authors or contributors be liable for any damages or legal consequences arising from the use or misuse of this software.

---

## 2. Reporting Vulnerabilities in MantisVision

If you discover a security vulnerability within MantisVision itself, we appreciate your help in disclosing it to us responsibly.

### How to Report
* Please **do not** report vulnerabilities through public GitHub issues, discussions, or social media.
* Submit a report via GitHub Private Vulnerability Reporting on the repository or contact the project maintainers directly.

### What to Include in Your Report
* Description of the vulnerability and attack vector.
* Detailed steps to reproduce or a minimal proof of concept.
* Impact assessment and affected components (Frontend, FastAPI Backend, Celery Worker, or Sandbox runtime).
* Any proposed mitigations or patches, if available.

### Our Commitment
* We will acknowledge receipt of your vulnerability report within 48 hours.
* We will investigate and provide an estimated timeline for remediation.
* We will publish an advisory and release a security update once the issue is resolved.

---

## 3. Upstream Google Mantis ADK Engine Vulnerabilities

MantisVision embeds and orchestrates the **Google Mantis ADK 2.0** core engine (`backend/mantis_engine`). 

* **Upstream Engine Scope**: Any vulnerabilities, bugs, or security concerns identified specifically within the core **Google Mantis ADK engine**, AST surveyor components, or Google ADK workflow graph runners should be reported directly to the upstream **Google Mantis project** and Google's Security Team:
  * **Google Bug Hunters (VRP)**: [https://bughunters.google.com](https://bughunters.google.com)
  * **Google Mantis Repository**: [https://github.com/google/mantis](https://github.com/google/mantis)
* **MantisVision Platform Scope**: Vulnerabilities relating to MantisVision's web dashboard, Next.js frontend, FastAPI backend endpoints, Celery worker orchestration, TOTP authentication, database layer, or reverse proxy should be reported to this repository as detailed in Section 2 above.
