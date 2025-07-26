---
title: Live Programming in Hostile Territory
description: 'Live programming research gravitates towards the creation of isolated environments whose success is measured by domination: achieving adoption by displacing rather than integrating with existing tools and practices. To counter this tendency, we advocate that live programming research broaden its purview from the creation of new environments to the augmenting of existing ones and, through a selection of prototypes, explore three adversarial strategies for introducing programmatic capabilities into existing environments which are unfriendly or antagonistic to modification. We discuss how these strategies might promote more pluralistic futures and avoid aggregation into siloed platforms.'
author: 'Chris Shank, Orion Reed'
date: 2025-07-21
---

<div style="max-width: 600px; margin: 4rem auto 2rem auto;">

_"[People] make their own history, but they do not make it as they please; they do not make it under self-selected circumstances, but under circumstances existing already, given and transmitted from the past."_
<span style="max-width: 600px; text-align: right; display: block;">— Karl Marx</span>

</div>

# Abstract

Live programming research gravitates towards the creation of isolated environments whose success is measured by domination: achieving adoption by displacing rather than integrating with existing tools and practices. To counter this tendency, we advocate that live programming research broaden its purview from the creation of new environments to the augmenting of existing ones and, through a selection of prototypes, explore three _adversarial strategies_ for introducing programmatic capabilities into existing environments which are unfriendly or antagonistic to modification. We discuss how these strategies might promote more pluralistic futures and avoid aggregation into siloed platforms.

# Introduction

Live programming research is broadly concerned with the creation of programming systems which provide immediate feedback on the dynamic behavior of a program even while running @Rein2018. This promise of immediate feedback requires the ability to modify, inspect, and manipulate programs while they execute—capabilities that established programming environments, designed around edit-compile-run cycles, cannot reliably provide. We believe this fundamental mismatch drives live programming research to face inwards, towards the _creation of fully circumscribed universes_ — often viewed as the most pragmatic means to ensure the runtime malleability that liveness requires. This inward focus produces systems which can be operated on from within themselves, but neglect their participation in wider contexts of use @Clark2017, encouraging what Kell describes as a success-by-domination strategy @Kell2020 where systems achieve adoption by displacing rather than integrating with existing tools and practices.

Whereas traditional programming leverages ubiquitous plaintext infrastructures that resist single-system dominance through their simplicity and interoperability @Hall2015, live programming's visual requirements largely preclude utilizing this pluralistic foundation. This threatens to shift the experience of programming into one mediated through siloed platforms, losing the freedom and plurality that plaintext infrastructures provide. Rather than accept this trajectory, we advocate for this community to extend its research from the creation of new environments to the augmenting of existing ones, situating new systems in their present contexts of use.

We explore three strategies for live programming in 'hostile territory'—environments that are unfriendly or antagonistic to modification. Central to these strategies is _free addressability_—a property we argue is essential for augmenting systems without requiring cooperation from their original creators. We demonstrate, through a selection of prototypes from the _folkjs_ research project @Shank2025, how we can exploit the addressable surfaces of user interfaces to situate new affordances in environments that were never designed to accommodate them. These interventions are not ends in themselves, but create fragile bridges that demonstrate the potential of more robust infrastructure and, by setting expectations of interoperability, make it harder to retreat into isolation.

# Free Addressability

The practice of information hiding—originally advocated by Parnas to support "centralized management process for large, disconnected teams" @Tchernavskij2019—creates challenges for software evolution, particularly in contexts where multiple authors work across organizational boundaries rather than within coordinated teams. As Ostermann et al. observe, it is unclear how to decide up-front which design decisions should be hidden versus exposed, and software evolution often brings new stakeholders who need access to previously hidden information @Ostermann2011. This results in what Basman et al. call "hermetic" systems—isolated environments that "give insufficient consideration to what lies outside the system" @Basman2018a. While information hiding serves its intended purpose within coordinated development teams, contemporary software ecosystems increasingly demand cross-system integration and external extensibility. Our approaches require reaching into systems whose internal components these design choices obscure.

We believe _free addressability_—a term we adopt from Basman et al. @Basman2018a—is key to enabling outward-facing integration and moving beyond success-by-domination strategies. Free addressability embraces transparent, publicly addressable state through queries, selectors, names, or other mechanisms that make parts of a running system targetable from the outside without requiring permission or coordination from the original creators, seeking to "maximally advertise the structure of the application via a transparent addressing scheme" @Basman2018a.

Our adversarial strategies exploit the fact that user interfaces often expose more addressable surfaces than the underlying program—through DOM elements, accessibility trees, and visual components. This disparity creates crucial leverage points for live programming interventions, allowing us to exploit addressability where it exists and demonstrating where additional addressability would be beneficial. These addressable surfaces provide the basis for working in hostile territory by offering ways to situate live programming capabilities within environments that were never designed to accommodate them.

# Strategies

Our strategies draw inspiration from what Doctorow calls _"adversarial interoperability"_ - interfacing with systems without the permission of their original creators @Doctorow2019. By exploiting the addressable surfaces of user interfaces, we can introduce live programming capabilities through three distinct approaches that work around, rather than require, system cooperation.

We explore three approaches that differ in their relationship between _system_ and _environment_:

- **Annotating** existing environments with new affordances
- **Embedding** systems into heterogenous host environments
- **Extending** closed systems through re-appropriation of available addressing schemes.

## Adversarial Annotation

Adversarial annotation challenges the assumption that live programming requires purpose-built universes, making it possible to embed new affordances where people already work. Rather than creating destinations for users to visit, annotation distributes programming capabilities as lightweight augmentations that attach to existing structure—demonstrating that environments are not the only path to liveness.

While web-based systems often break when their DOM tree structure is modified, they often tolerate the addition of _new_ attributes that encode interactive functionality. This tolerance creates one path for escaping isolated environments — annotations can introduce liveness without requiring users to abandon their tools or migrate their work.

Our first prototype demonstrates how we can annotate regions of text with a custom HTML attribute that binds a Language Server Protocol (LSP) server—a standardized interface for providing language-specific programming assistance—directly to existing web content. This annotation adds syntax highlighting, diagnostics, and auto-completion to web pages or text editors that lack these capabilities, without requiring any structural modifications to the host document. The CSS Custom Highlight API enables syntax highlighting and diagnostic underlines to be rendered as visual overlays, while tooltips display auto-completion suggestions and error messages without altering the underlying text. Some LSP functionality, such as code folding, cannot be implemented through pure annotation since it requires structural changes, but this approach demonstrates how substantial programming capabilities can be introduced through minimally invasive interventions.

![A custom HTML attribute that binds an LSP server to an editable style tag](lsp.mp4)

The flexible pattern matching of CSS selectors enables these annotations to discover and interact with their surroundings, working opportunistically with available document structure rather than requiring pre-negotiated structural agreements. Unlike environments that must control their entire context, annotations can situate themselves within foreign systems and coexist with existing features.

Our second prototype ports event propagators @Reed2024 to a custom HTML element, creating computational relationships between interface elements that enable spreadsheet-like reactivity between arbitrary UI components of existing websites. Through CSS selectors, these elements can define connections between DOM nodes, transforming static web pages into reactive documents where changes propagate automatically across components.

Annotations can also encourage the decomposition of functionality trapped within monolithic systems, making it available as reusable components. Our folk-sync attribute exemplifies this approach by extracting collaborative editing capabilities from systems like Webstrates and exposing them through a simple HTML annotation. This attribute makes document subtrees collaborative across devices, enabling real-time shared editing of any web content without requiring migration to dedicated platforms.

The composability of these annotations becomes apparent when multiple augmentations work together to create capabilities that exceed the sum of their parts. The figure below shows a chess board, event propagator, and spreadsheet—each authored as standard HTML with appropriate annotations—that not only synchronize state across multiple windows through folk-sync, but also react to each other's changes through event propagators. Moving a chess piece triggers the event propagator to log the move in the spreadsheet, creating a real-time game log that updates across all connected devices. This demonstrates how lightweight interventions can compose into rich, interactive systems that exhibit the computational relationships and collaborative capabilities typically associated with purpose-built environments, yet remain situated within ordinary web pages that can be inspected, modified, and extended through standard web technologies.

![A chess board, event propagator, and spreadsheet](chess.mp4)

These interventions succeed by creating the experience of an environment without requiring one — users encounter live programming capabilities that feel indigenous to their current tools rather than isolated systems forcing them to move elsewhere.

## Adversarial Embedding

_Adversarial embedding_ focuses on changing the relationship between web-based software systems and their host environments. Unlike annotation, which augments existing systems in place, embedding makes whole systems composable within new contexts by altering how they interface with the outside world. This approach recognizes that software authors are constrained by tooling conventions, security policies like same-origin restrictions, and architectural assumptions that treat these systems as discrete, non-composable units and discourage unmediated cross-system communication. To make systems embeddable in new host environments, we can work _cooperatively_ with software authors or _adversarially_ by crossing the containment boundaries of iframe isolation, domain restrictions, and sandboxing policies.

Web applets @Rupert2025 demonstrate a cooperative approach, enabling any web-based software to be embedded within other web pages through a lightweight event-based protocol wrapped around an iframe, allowing web pages to externalize specific state and actions to their host environment. The applet author retains full control over what to expose and must opt-in to participating in a shared protocol. This requires minimal work to add to existing systems but becomes challenging when seeking to externalise rich or complex behavior, requiring great care to design interfaces which anticipate future interactions with the system.

In some cases, we can create systems that expose their entire internal state through addressable surfaces like the DOM. Our HTML spreadsheet prototype implements the system as custom HTML elements where each cell is a DOM element with properties for its evaluated value, formula, and dependencies. This makes every aspect addressable through CSS selectors and enables permissionless augmentation—modifying behavior at runtime, using CSS to transform cell positions, performing graph layout of dependencies, or creating entirely new visualizations. External systems can query state, subscribe to changes, and extend functionality without requiring ongoing coordination between original and further authors, though this requires systems designed from the ground up with full addressability.

![A freely-addressable HTML spreadsheet element](spreadsheet.mp4)

When systems provide no embedding interfaces, our cross-iframe injection prototype demonstrates how adversarial techniques can force integration by circumventing the single-origin security model. The elevated privileges of web extensions allow us to bypass iframe containment boundaries and inject JavaScript code into both a host page and an embedded iframe from different domains and establish real-time bidirectional communication between systems that typically exist in isolation. This approach reveals how security models designed to prevent malicious interference also encumber interoperability and integration, suggesting a need for security architectures designed around composition rather than isolation.

![Web extension injecting capabilities across iframe boundaries](cross-iframe-relationships.mp4)

## Adversarial Extension

When systems provide no addressable surfaces, adversarial extension creates addressability by re-purposing whatever infrastructure remains available. Unlike annotation, which works with systems designed to tolerate additions, or embedding which requires systems that allow runtime code injection, extension operates on closed systems which do not tolerate addition to their internal state or modification to their execution environment.

Accessibility APIs represent an addressable infrastructure ripe for re-appropriation. Operating systems expose accessibility trees to support assistive technologies, creating a parallel addressable representation of every running application's interface. While this interface provides only a limited view of application state focused on user-facing elements rather than internal program logic, it offers near-universal coverage across all running applications.

Our prototype demonstrates how this infrastructure can be repurposed for external augmentation—a WebSocket server connects web interfaces to accessibility and windowing APIs, making it possible to query, subscribe to, and modify the interface state of any running application. This creates an addressable surface where none existed before.

![Ivory app extended with editable accessibility tree and regex-based text editing UI](axtree.mp4)

The accessibility tree prototype shows the Ivory messaging application augmented with two external interfaces: an editable outline view of its accessibility tree and a regex-based find-and-replace interface for text editing. This regex functionality, absent from Ivory itself, demonstrates the kind of read-write querying possible across boundaries we usually consider closed—proprietary applications with no APIs, closed source code, or deliberate restrictions on extensibility. The positioning system leverages accessibility coordinate information to spatially attach these augmentations to their target elements, making them feel more like native features than external overlays. Since applications cannot opt out of accessibility infrastructure without breaking assistive technology compliance, this approach works even with systems designed to resist external intervention, and the same augmentations can work universally across any application.

These three strategies are complementary rather than competing—each addresses different constraints in the landscape of existing systems. _Annotation_ works with systems that tolerate additions, _embedding_ enables portability across environments, and _extension_ exploits mandatory addressable surfaces when no other options remain. The choice of strategy depends on the specific affordances and restrictions of the target environment.

# Related Work

Systems like Sifter @Huynh2006, Vegimite @Lin2009, Rousillon @Chasins2018, Wildcard @Litt2020, and Joker @Katongo2022 exemplify adversarial strategies by enabling end-users to customize web pages, scraping data into spreadsheets and tables, and reflecting modifications back to the original page. By packaging themselves as web extensions rather than standalone applications, these systems situate themselves inside the environments they augment rather than requiring users to bring their data elsewhere.

Whereas the systems above try to abstract away web technologies behind familiar interfaces, Webstrates @Klokmose2015 takes the opposite approach, creating a collaborative authoring environment where "the state of the DOM itself corresponds to the authorial shared state" @Basman2018a. Webstrates demonstrates the potential of exploiting the DOM's inherent addressability as a foundation for live programming in shared authorial environments. Our DOM sync attribute explores similar territory, enabling real-time collaborative editing of DOM structures without requiring migration to a dedicated platform.

Engraft @Horowitz2023 explores composition between live programming tools by creating interfaces that allow different systems to be embedded within each other. While Engraft acknowledges that live programming systems should integrate with the outside world, its focus on inward composition—maintaining properties within controlled environments—contrasts with our emphasis on outward integration into hostile territory.

# Limitations & Future Work

Our current exploration focuses on additive modifications and does not address removing or replacing parts of running programs. The approaches we present also concentrate heavily on UI-level intervention points. Significant work remains in applying adversarial techniques at other levels of the software stack, from runtime systems to operating system primitives. Kell's work on liballocs suggests one promising direction for free addressability at the level of Unix processes @Kell2018.

A key limitation emerges around the relationship between addressability and modifiability. While _free addressability_ focuses on making system parts targetable, it doesn't address how those parts can actually be modified. The DOM is exploitable because CSS selectors provide addressing while referenced elements expose clear manipulation interfaces—a relationship that remains undertheorized in our work.

Most of our examples target web and browser contexts, limiting their applicability to the broader software ecosystem. Future work should explore how these strategies translate to desktop applications, mobile environments, and system-level software. The fragility of some approaches—such as relying on unstable CSS selectors or working around obfuscated DOM structures—highlights the need for more robust addressing schemes.

An important direction for future research involves enabling interoperability and co-existence between different live programming models that may have conflicting guarantees or execution models. What primitives enable different computational paradigms to work together? These questions become urgent as we move toward ecosystems where multiple live programming systems must coexist and collaborate.

Perhaps most ambitiously, we envision extending these principles to operating system design. What would it look like if accessibility trees provided stable, rich addressing schemes for all running applications? How might we design OS-level APIs that assume external composition rather than treating it as an afterthought?

# Conclusion

When users experience live programming capabilities situated in place rather than sequestered in dedicated environments, we hope they begin to see such integration as normal rather than exceptional. We believe pluralistic practices that subvert intended boundaries create pressure like water finding cracks — persistent forces that gradually reshape systems toward openness.

Much of live programming research focuses on creating better environments without considering how change actually happens in computing ecosystems. We believe the community needs to confront the question of _change_: how do isolated programming tools evolve into integrated, composable ecologies without falling into success-by-domination strategies? Our approach rests on the belief that fragile bridges and adversarial interventions create social pressures that drive systemic change. By demonstrating what becomes possible when addressable surfaces are exploited, we establish expectations of interoperability and integration. These prototypes point toward a future where external composition is a design assumption rather than an afterthought.

The scale of this challenge becomes clear when we consider the difficulty of departing from tradition. Plaintext infrastructures resist single-system dominance, but this resistance was not inevitable. As Hall observes, what we think of as "human-readable plaintext" is actually the massive set of text encoding, display, manipulation, and processing artifacts currently ubiquitous in computing: _"ASCII, UTF8, text editors, text-field or text-area UI widgets, terminals, keyboards, String types, object-to-String rendering functions, human-readable format libraries, tokenizers, parsers, escape sequences and input sanitization, Base64 encoding, line-ending and whitespace conventions, and the fallback data-flavor of the copy/paste clipboard"_ @Hall2015. This ubiquity required decades of standardization, adoption, and gradual convergence—it did not emerge from any inherent philosophical commitment to openness. The challenge is achieving similar ubiquity for live programming systems. This is not to advocate that specialized environments like Blender or Ableton should be decomposed—such tools serve important purposes within their domains. Rather, we argue that _all systems_ should consider their participation in broader ecosystems rather than operating in complete isolation.

By working in hostile territory, we hope to demonstrate that live programming need not retreat into isolated environments to achieve its goals. The strategies we explore—annotation, embedding, and extension—offer different paths for engaging with the existing software landscape as it exists today. While our prototypes remain fragile and limited, they point to a future where live programming capabilities become as ubiquitous as plaintext itself. The question is not whether any single system will achieve domination, but whether we can work within our inherited circumstances. In this view, live programming research becomes work of _transformation_ rather than _escape_.
