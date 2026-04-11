# ConvoSpan Signal Graph Specification

## Purpose

The Signal Graph transforms raw scraped signals from the ConvoSpan Intel engine into structured intelligence that drives outreach automation.

Instead of treating leads as isolated records, the system models relationships between companies, people, technologies, and events.

This graph enables the SaaS platform to detect buying intent and automatically trigger campaigns.

---

# Concept Overview

Traditional outreach tools operate on static lead lists.

ConvoSpan operates on **dynamic signal intelligence**.

Signal Graph Model:

```id="n8d4qk"
Company
   │
   ├── hires
   │
   ├── invests_in
   │
   ├── expands_facility
   │
   └── adopts_technology
```

These events form the basis for predicting operational needs.

---

# Core Entities

The graph is composed of several node types.

## Company

Represents an organization discovered through scraping or enrichment.

Attributes:

```id="8d2m1p"
company_id
domain
industry
country
employee_count
growth_stage
```

---

## Person

Represents individuals identified through company data or LinkedIn.

Attributes:

```id="1x7rt0"
person_id
name
title
department
seniority
linkedin_url
```

---

## Technology

Represents tools or systems used by the company.

Attributes:

```id="o4o8b3"
technology_name
category
vendor
adoption_level
```

---

## Event

Represents time-bound signals detected from scraping or news.

Attributes:

```id="k1xv3e"
event_type
timestamp
confidence_score
source
```

---

# Signal Types

Signals represent business changes that indicate potential need.

## Hiring Expansion

Detected when job listings increase significantly.

Example:

```id="pbegil"
20 new operations roles posted
```

Possible interpretation:

```id="svz5os"
Scaling operations infrastructure
```

---

## Facility Expansion

Detected from company news or real estate filings.

Example:

```id="6fcdh4"
New plant opening
```

Possible interpretation:

```id="1bnzpo"
Infrastructure and facility services demand
```

---

## Technology Adoption

Detected from stack analysis or tech mentions.

Example:

```id="b4q4gq"
Migration to cloud ERP
```

Possible interpretation:

```id="m33c6t"
Digital transformation initiative
```

---

## Funding or Investment

Detected from press releases or startup databases.

Example:

```id="4qnv9t"
Series B funding announcement
```

Possible interpretation:

```id="od7tn8"
Budget available for scaling operations
```

---

# Signal Strength Calculation

Signals are scored based on confidence and freshness.

Formula:

```id="48k98p"
signal_strength = confidence_score × freshness_factor
```

Freshness decays exponentially.

Example:

```id="55xg8t"
freshness = e^(-days_since_event / 30)
```

---

# Buying Intent Score

Signals combine to generate an intent score.

Example model:

```id="81v3db"
intent_score =
  hiring_weight × hiring_signal +
  expansion_weight × facility_signal +
  technology_weight × tech_signal
```

Score range:

```id="de31pt"
0 – 100
```

---

# Lead Trigger Conditions

Campaigns are triggered when thresholds are exceeded.

Example:

```id="9a3qyw"
intent_score > 65
```

This automatically activates outreach.

Example trigger:

```id="ssiqrx"
company detected expanding operations
→ identify plant head
→ initiate outreach campaign
```

---

# Graph Relationships

Relationships connect entities.

Examples:

```id="x45cf7"
Person → works_at → Company
Company → adopts → Technology
Company → announces → Event
Event → indicates → Operational Need
```

These relationships enable deeper insights.

---

# Graph Storage

The graph can be implemented using:

Option 1:

```id="q3c65k"
Neo4j
```

Option 2:

```id="36kjij"
PostgreSQL + pgvector
```

Option 3:

```id="2e6iq8"
RedisGraph
```

Initial implementation may use relational tables with graph-like queries.

---

# Signal Processing Pipeline

Signal detection occurs through several stages.

Pipeline:

```id="o3b8dl"
scrape company data
→ extract signals
→ score signals
→ update graph nodes
→ compute intent score
→ trigger campaigns
```

---

# Integration With SaaS Platform

When signals exceed threshold:

1. SaaS identifies target personas.
2. Campaign planner creates outreach workflow.
3. Tasks are dispatched to Edge Nodes.

Flow:

```id="5a5q8i"
Signal Graph
   ↓
Campaign Planner
   ↓
Task Dispatcher
   ↓
Edge Node Execution
```

---

# Example Scenario

Example workflow:

Signal detected:

```id="h7d7mq"
Company opening new manufacturing facility
```

Graph interpretation:

```id="p3lkns"
Operational expansion
```

Target persona identified:

```id="3kp5pw"
Plant Head
```

Campaign triggered:

```id="0k1qum"
LinkedIn connection + infrastructure discussion
```

---

# Multi-Signal Correlation

Multiple signals increase confidence.

Example:

```id="wykz4o"
Hiring surge
+ facility expansion
+ technology investment
```

Combined interpretation:

```id="rft5cz"
Major operational scaling initiative
```

Intent score increases significantly.

---

# Signal Aging

Signals lose value over time.

Lifecycle:

```id="rvh0un"
Hot   → 0-30 days
Warm  → 30-90 days
Cold  → 90+ days
```

Cold signals should not trigger campaigns.

---

# Visualization

Graph dashboards can display relationships visually.

Example nodes:

```id="5q1kvf"
Company
Person
Technology
Event
```

Example edges:

```id="7m9u9s"
works_at
announced
adopted
triggered
```

---

# Future Enhancements

Planned improvements:

* predictive intent modeling
* buyer committee mapping
* cross-company signal correlation
* AI-generated opportunity scoring
* dynamic campaign triggers
