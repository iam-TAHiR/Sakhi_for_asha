# Citations and References

Sources behind the design and content of **Sakhi for ASHA**, grouped by the part of the project they support. Each entry is a public document or web page (government, WHO, peer-reviewed or official documentation).

> **Disclaimer:** Clinical rules, thresholds, visit schedules and vaccine schedules in this project are for decision support only. Verify them against the latest MoHFW / NHM guidelines and have them reviewed by a qualified medical professional before any real-world use.

---

## Contents

1. [Background: ASHA workers and the problem](#1-background-asha-workers-and-the-problem)
2. [Feature 1: Clinical Symptom and Emergency Flagging Engine](#2-feature-1-clinical-symptom-and-emergency-flagging-engine)
3. [Feature 2: Analytics and KPI Dashboard Engine](#3-feature-2-analytics-and-kpi-dashboard-engine)
4. [Feature 3: Beneficiary and Visit Lifecycle Management](#4-feature-3-beneficiary-and-visit-lifecycle-management)
5. [Feature 4: Immunization Calculation Engine](#5-feature-4-immunization-calculation-engine)
6. [Feature 5: Conversational Query Assistant (deterministic chatbot)](#6-feature-5-conversational-query-assistant-deterministic-chatbot)
7. [Features 6 and 7: Two-stage NLP pipeline](#7-features-6-and-7-two-stage-nlp-pipeline)
8. [Database, offline support and deployment](#8-database-offline-support-and-deployment)
9. [Frontend and backend technologies](#9-frontend-and-backend-technologies)
10. [Source coverage summary](#10-source-coverage-summary)

---

## 1. Background: ASHA workers and the problem

Supports: Problem Statement, project motivation.

| # | Source | Link |
|---|--------|------|
| 1.1 | National Health Mission (MoHFW), "About Accredited Social Health Activist (ASHA)" | https://nhm.gov.in/index1.php?lang=1&level=1&sublinkid=150&lid=226 |
| 1.2 | NHSRC, "ASHA Update 2023" | https://www.nhsrcindia.org/sites/default/files/2023-09/ASHA_UPDATE_2023.pdf |
| 1.3 | Vikaspedia, "Accredited Social Health Activist (ASHA)" | https://vikaspedia.in/health/nrhm/national-health-mission/initiatives-for-community-participation-under-nhm/accredited-social-health-activist-(asha) |
| 1.4 | Fathima FN et al., "Assessment of 'Accredited Social Health Activists': A National Community Health Volunteer Scheme in Karnataka State, India" (PMC4438657) | https://pmc.ncbi.nlm.nih.gov/articles/PMC4438657 |
| 1.5 | Bhanderi DJ et al., "Evaluation of accredited social health activists in Anand District of Gujarat" (PMC6069656) | https://pmc.ncbi.nlm.nih.gov/articles/PMC6069656 |
| 1.6 | Bajpai N, Dholakia RH, "Improving the Performance of Accredited Social Health Activists in India", Columbia University Working Paper No. 1, 2011 | https://academiccommons.columbia.edu/doi/10.7916/D8CN7C1N/download |
| 1.7 | NIOS, "About ASHA" (ASHA training and certification with MoHFW and NHSRC) | https://asha.nios.ac.in/about-asha.php |
| 1.8 | Government of Uttarakhand Health Dept., "Accredited Social Health Activist (ASHA)" | https://health.uk.gov.in/scheme/accredited-social-health-activist-asha/ |

---

## 2. Feature 1: Clinical Symptom and Emergency Flagging Engine

Supports: danger-sign rules, blood pressure thresholds, urgent referral logic.

| # | Source | Link |
|---|--------|------|
| 2.1 | World Health Organization, "Pre-eclampsia" fact sheet | https://www.who.int/news-room/fact-sheets/detail/pre-eclampsia |
| 2.2 | WHO Vietnam, "Pre-eclampsia" fact sheet (definition, severe symptoms, prevention) | https://www.who.int/vietnam/news/fact-sheets/detail/pre-eclampsia |
| 2.3 | OpenLearn Create (Open University), "Classification of pre-eclampsia" (mild vs. severe thresholds) | https://www.open.edu/openlearncreate/mod/oucontent/view.php?id=50&section=20.4.1 |
| 2.4 | NHS (UK), "Pre-eclampsia" | https://www.nhs.uk/conditions/Pre-eclampsia/ |
| 2.5 | Scripps Health, "What Is Preeclampsia in Pregnancy?" (severe-range BP of 160/110 and emergency signs) | https://www.scripps.org/news_items/7133-what-is-preeclampsia-in-pregnancy |
| 2.6 | Texas Health Resources, "Preeclampsia: What It Is, Symptoms and Treatment" | https://www.texashealth.org/baby-care/Pregnancy/preeclampsia-what-it-is-symptoms-and-treatment |

**Note on thresholds:** 140/90 mmHg is generally the level at which pre-eclampsia is suspected, and 160/110 mmHg or above is treated as the severe range (sources 2.1, 2.3, 2.5). Make sure the flagging engine's severity levels (normal, watch, urgent, emergency) match the cut-offs you adopt, and document them in code comments.

---

## 3. Feature 2: Analytics and KPI Dashboard Engine

Supports: choice of dashboard indicators (ANC, institutional delivery, HBNC, immunization coverage, visits done vs. due).

| # | Source | Link |
|---|--------|------|
| 3.1 | MoHFW, National Workshop presentation: Key Performance Indicators for RMNCH+A (ANC, HBYC, immunization) | https://wcd.nic.in/poshan/Events/NationalWorkshop/MoHFW_NW_20-03-2018.pdf |
| 3.2 | NHM Himachal Pradesh, "Performance Linked Incentive" instruction (HBNC, ANC and immunization indicators with 80% benchmarks) | https://nhm.hp.gov.in/storage/app/media/uploaded-files/Instruction%20-%20PLI%20to%20newly%20appointed%20CHOs-Dated%2018.4.2023.pdf |
| 3.3 | NHM, "ASHA Incentives" 2025-26 (activities ASHAs are measured and paid on) | https://www.nhm.gov.in/New-Update-2025-26/ASHA-incentive/ASHA%20Incentives.pdf |
| 3.4 | NHM Assam, "ASHA Incentive Master Claim Form" 2024 | https://nhmssd.assam.gov.in/APPMS_2024_25/ASHA_documents/ASHA_Incentive_Master_Claim_Form_Draft_ENGLISH_2024.pdf |
| 3.5 | Lok Sabha / e-Parlib, answer on ASHA incentives and Team Based Incentives | https://eparlib.nic.in/bitstream/123456789/985262/1/AU5049.pdf |
| 3.6 | Study on ASHA incentives, motivation and performance (PMC4789362) | https://pmc.ncbi.nlm.nih.gov/articles/PMC4789362 |
| 3.7 | PMC7536783, ASHA performance on RMNCH indicators (ANC registration, institutional deliveries, immunization sessions) | https://pmc.ncbi.nlm.nih.gov/articles/PMC7536783/table/T4 |

---

## 4. Feature 3: Beneficiary and Visit Lifecycle Management

Supports: visit types, visit schedule (HBNC and HBYC), what a home visit records.

| # | Source | Link |
|---|--------|------|
| 4.1 | MoHFW, Home Based Newborn Care (HBNC) and Home Based Care for Young Child (HBYC) portal, "About HBNC" | https://hbnc-hbyc.mohfw.gov.in/AboutUs/aboutHBNC |
| 4.2 | MoHFW HBNC/HBYC portal, "About" | https://hbnc-hbyc.mohfw.gov.in/about |
| 4.3 | MoHFW, "Handbook for ASHA on Home Based Care for Young Child" | https://hbnc-hbyc.mohfw.gov.in/assets/document/Handbook%20for%20ASHA%20on%20Home%20Based%20Care%20for%20Young%20Child-English.pdf |
| 4.4 | MoHFW, "Job Aid for ASHA on HBYC" | https://hbnc-hbyc.mohfw.gov.in/assets/document/English-Job%20Aid%20for%20ASHA%20on%20HBYC.pdf |
| 4.5 | NHSRC, "Post Partum Care: Home Visits for Normal Babies" | https://nhsrcindia.org/sites/default/files/2021-05/Post%20Partum%20Care%20Home%20Visits%20For%20Normal%20Babies%20English.pdf |
| 4.6 | NHSRC, "SNCU and LBW Follow-up Revised Guidelines", 2016 | https://www.nhsrcindia.org/sites/default/files/2021-03/SNCU%20and%20LBW%20follow%20up%20revised%20guidelines_20.10.2016.pdf |
| 4.7 | NHM Himachal Pradesh, "Home Based New Born Care Programme (HBNC)" | https://nhm.hp.gov.in/child-health/community-based-care/hbnc |
| 4.8 | NHM Assam, "HBNC leaflet (revised)" | https://nhm.assam.gov.in/sites/default/files/swf_utility_folder/departments/nhm_lipl_in_oid_6/menu/document/hbnc_leaflet_revised_eng.pdf |
| 4.9 | Nurturing Care, "India's Home Visiting Programme and Schedule" | https://nurturing-care.org/wp-content/uploads/2021/05/India.pdf |
| 4.10 | Field Exchange (ENN), "NEX Asia", HBNC home visits by ASHAs, 2020 | https://ennonline.net/sites/default/files/NEX-Asia-2_29June2020_13-15.pdf |

**Visit schedule used as reference:** HBNC visits on days 3, 7, 14, 21, 28 and 42 for institutional deliveries, with an additional day-1 visit for home deliveries (sources 4.1, 4.2, 4.5, 4.7). Follow-up HBYC visits continue at about 3, 6, 9, 12 and 15 months (sources 4.3, 4.4, 4.9).

---

## 5. Feature 4: Immunization Calculation Engine

Supports: due, upcoming and overdue vaccine calculation based on the National Immunization Schedule.

| # | Source | Link |
|---|--------|------|
| 5.1 | MoHFW, "Universal Immunization Programme" | https://www.mohfw.gov.in/sites/default/files/Universal%20Immunization%20Programme.pdf |
| 5.2 | MoHFW, Immunization Handbook for Medical Officers, "Unit 2: National Immunization Schedule" | https://main.mohfw.gov.in/sites/default/files/Unit2NationalImmunizationSchedule.pdf |
| 5.3 | MoHFW, "FAQ on Immunization for Program Managers" | https://nhm.gov.in/New_Updates_2018/NHM_Components/Immunization/Guildelines_for_immunization/FAQ_on_Immunization_for_Program_Manager-English.pdf |
| 5.4 | MoHFW, UIP overview document | https://mohfw.gov.in/sites/default/files/41016395871489662752.pdf |
| 5.5 | PIB / MoHFW, "India's Universal Immunization Programme", 28 June 2025 | https://mohfw.gov.in/en/press-info/8920 |
| 5.6 | PIB, National Vaccination Day factsheet, March 2026 (includes the newest additions to the programme) | https://static.pib.gov.in/WriteReadData/specificdocs/documents/2026/mar/doc2026320830601.pdf |
| 5.7 | Business Standard, "India's Universal Immunisation Programme", April 2025 (secondary source) | https://www.business-standard.com/health/india-universal-immunisation-programme-2025-vaccine-access-coverage-125042500520_1.html |

**Important:** The schedule changes as new vaccines are introduced. Before the demo, compare your vaccine list and ages against source 5.2 and the latest PIB / MoHFW update (source 5.6).

---

## 6. Feature 5: Conversational Query Assistant (deterministic chatbot)

Supports: using fixed, rule-based intent matching and templated answers instead of free-form generation for health information.

| # | Source | Link |
|---|--------|------|
| 6.1 | "Clinical Concept Extraction: a Methodology Review", arXiv:1910.11377 (explains why rule-based approaches are used in clinical settings: transparency and reliability without large annotated datasets) | https://arxiv.org/pdf/1910.11377 |

**Gap:** I did not find a single authoritative source specifically on "deterministic chatbots for community health workers". If your report needs one, cite 6.1 for the rule-based rationale, and describe the response templates as based on the MoHFW documents in sections 2, 4 and 5.

---

## 7. Features 6 and 7: Two-stage NLP pipeline

Supports: Stage 1 (clinical note to action plan) and Stage 2 (entity extraction and parameter resolution).

| # | Source | Link |
|---|--------|------|
| 7.1 | Bose P et al., "A Survey on Recent Named Entity Recognition and Relationship Extraction Techniques on Clinical Texts", *Applied Sciences*, 2021 | https://mdpi.com/2076-3417/11/18/8319 |
| 7.2 | "Clinical Concept Extraction: a Methodology Review", arXiv:1910.11377 (v1) | https://arxiv.org/pdf/1910.11377v1 |
| 7.3 | "Artificial intelligence in healthcare text processing: a review applied to named entity recognition", *Frontiers in Artificial Intelligence*, 2025, doi:10.3389/frai.2025.1584203 | https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1584203/epub |
| 7.4 | Encyclopedia (MDPI), "NER and RE Techniques on Clinical Texts" (summary of the Bose et al. survey) | https://encyclopedia.pub/15854 |

**Note:** Recent surveys (7.3, 7.4) observe that the research community has moved toward deep learning, while rule-based methods remain valued for transparency and low cost (7.1, 7.2). A rule-based, two-stage design is a reasonable choice for an offline, safety-sensitive MVP. State this trade-off openly in your hackathon presentation.

---

## 8. Database, offline support and deployment

Supports: choice of SQLite and the plan to run locally for the hackathon.

| # | Source | Link |
|---|--------|------|
| 8.1 | SQLite, "Appropriate Uses For SQLite" | https://www.sqlite.org/whentouse.html |
| 8.2 | SQLite Documentation | https://www.sqlite.org/docs.html |

**Why SQLite fits:** SQLite is designed for local, embedded storage with little or no administration, and it suits low to medium traffic. It is not designed for many computers writing to one database over a network, which matches the plan of running everything on one laptop (source 8.1).

---

## 9. Frontend and backend technologies

Add the official documentation for the frameworks and libraries your repo actually uses.

| Area | Technology | Documentation link |
|------|------------|--------------------|
| Frontend | `<framework>` | `<link>` |
| Backend | `<framework>` | `<link>` |
| NLP | `<library>` | `<link>` |
| Charts | `<library>` | `<link>` |

---

## 10. Source coverage summary

| Project part | Citation sections | Evidence strength |
|--------------|-------------------|-------------------|
| Problem statement | 1 | Strong (government and peer-reviewed) |
| Symptom flagging | 2 | Strong for pre-eclampsia; other danger signs (newborn, child) still need MoHFW sources |
| KPI dashboard | 3 | Moderate (state and national documents) |
| Visit lifecycle | 4 | Strong (MoHFW HBNC/HBYC) |
| Immunization | 5 | Strong (MoHFW, PIB) |
| Chatbot | 6 | Limited (one methodological source) |
| NLP pipeline | 7 | Moderate (survey papers) |
| Database and offline | 8 | Strong (SQLite official) |

**Suggested additions:** MoHFW guidelines on newborn and child danger signs (IMNCI / HBNC danger-sign checklist), antenatal care (PMSMA and ANC schedule), and any datasets or word lists used for the NLP stages.
