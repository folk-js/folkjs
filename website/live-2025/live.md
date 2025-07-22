---
title: Live Programming in Hostile Territory
description: 'Live programming research gravitates inward towards the creation of isolated environments whose success is measured by domination: achieving adoption by displacing rather than integrating with existing tools and practices. To counter this tendency, we advocate that live programming research broaden its purview from the creation of new environments to the augmenting of existing ones and, through a selection of prototypes, explore three _adversarial strategies_ for introducing programmatic capabilities into existing environments that actively resist modification. We discuss how these strategies might promote more pluralistic futures and avoid aggregation into siloed platforms.'
date: 2025-07-21
---

<div style="max-width: 600px; margin: 4rem auto 2rem auto;">

_"[Humans] make their own history, but they do not make it as they please; they do not make it under self-selected circumstances, but under circumstances existing already, given and transmitted from the past."_
<span style="max-width: 600px; text-align: right; display: block;">— Karl Marx</span>

</div>

# Abstract

Live programming research gravitates inward towards the creation of isolated environments whose success is measured by domination: achieving adoption by displacing rather than integrating with existing tools and practices. To counter this tendency, we advocate that live programming research broaden its purview from the creation of new environments to the augmenting of existing ones and, through a selection of prototypes, explore three _adversarial strategies_ for introducing programmatic capabilities into existing environments which are unfriendly or antagonistic to modification. We discuss how these strategies might promote more pluralistic futures and avoid aggregation into siloed platforms.

# Introduction

Live programming research is broadly concerned with the creation of programming tools which provide immediate feedback on the dynamic behavior of a program even while running [^1]. We believe live programming faces inwards, towards the creation of _fully circumscribed universes_ — often viewed as the most pragmatic means to explore new forms of liveness. This inward focus produces systems which can be operated on from within themselves, but neglect their participation in wider contexts of use [^2], encouraging what Kell describes as a success-by-domination strategy [^3] where systems achieve adoption by displacing rather than integrating with existing tools and practices.

While traditional programming leverages ubiquitous plaintext infrastructures that resist single-system dominance through their simplicity and interoperability [^4], live programming's visual requirements largely preclude utilizing this pluralistic foundation. This threatens to shift the experience of programming into one mediated through siloed platforms, losing the freedom and plurality that plaintext infrastructures provide. Rather than accept this trajectory, we advocate for this community to extend its research from the creation of new environments to the augmenting of existing ones, situating new systems in existing contexts of use.

We explore three strategies for live programming in 'hostile territory'—environments that are unfriendly or antagonistic to modification. Central to these strategies is _free addressability_—a property we argue is essential for augmenting existing systems without requiring cooperation from their original creators. We demonstrate, through a selection of prototypes from the _folkjs_ research project [^5], how live programming can exploit the addressable surfaces of existing user interfaces to situate itself in environments that were never designed to accommodate it. These interventions are not ends in themselves, but create fragile bridges that demonstrate the potential of more robust infrastructure and, by setting expectations of interoperability, make it harder to retreat into isolation.

# Free Addressability

The practice of information hiding—originally advocated by Parnas to support "centralized management process for large, disconnected teams" [^6]—creates challenges for software evolution, particularly in contexts where multiple authors work across organizational boundaries rather than within coordinated teams. As Ostermann et al. observe, it is unclear how to decide up-front which design decisions should be hidden versus exposed, and software evolution often brings new stakeholders who need access to previously hidden information [^7]. This results in what Basman et al. call "hermetic" systems—isolated environments that "give insufficient consideration to what lies outside the system" [^8].

We believe _free addressability_—a term we adopt from Basman et al. [^8]—is a necessary property for the additive modifications our strategies require. Free addressability embraces transparent, publicly addressable state through queries, selectors, names, and other means to target pieces of state within a system, making internal components reachable from the outside without requiring permission or coordination from the original creators.

Our adversarial strategies exploit the fact that user interfaces often expose more addressable surfaces than the underlying program—through DOM elements, accessibility trees, and visual components. This disparity creates crucial leverage points for live programming interventions, allowing us to exploit existing addressability where it exists while revealing opportunities to improve addressability where it doesn't. These addressable surfaces provide the basis for working in hostile territory by offering ways to situate live programming capabilities within environments that were never designed to accommodate them.

# Strategies

Our strategies draw inspiration from what Doctorow calls _"adversarial interoperability"_ - interfacing with systems without the permission of their original creators [^9]. We exploit the addressable surfaces of existing environments to situate live programming capabilities where they were never intended to be.

We explore three approaches that differ in their relationship between system and environment:

- _Annotating_ existing surfaces with new affordances
- _Embedding_ systems into unknown host environments
- _Extending_ closed systems through re-appropriation of available addressing schemes.

## Adversarial Annotation

forms of annotation. That is, augmentation without necessarily needing to change the structure of the underlying environment.

Adversarial annotation challenges the assumption that live programming requires purpose-built universes, making it possible to embed new affordances where people already work. Rather than creating destinations for users to visit, annotation distributes live programming capabilities as lightweight augmentations that attach to existing structure—demonstrating that environments are not the only path to liveness.

While web-based systems often break when their DOM tree structure is modified, they tolerate the addition of new attributes that encode new capabilities. This tolerance creates one path for escaping isolated environments — annotations can introduce liveness without requiring users to abandon their existing tools or migrate their work. The flexible pattern matching of CSS selectors enables these annotations to discover and interact with their surroundings, working opportunistically with existing document structure rather than requiring pre-negotiated structural agreements. Unlike environments that must control their entire context, annotations can situate themselves within foreign systems and coexist with the structural arrangements they encounter.

Our prototypes demonstrate the embedding of live programming affordances into existing contexts as if they were native features:

- a custom HTML attribute that bind language servers to editable text content
- a custom HTML attribute DOM sync attributes make document subtrees collaborative across devices.
- Event propagators create computational relationships between interface elements.

These interventions succeed by creating the experience of an environment without requiring one — users encounter live programming capabilities that feel indigenous to their existing tools rather than isolated systems forcing them to move elsewhere.

![An custom HTML attribute added to a style tag that binds an LSP server.](lsp.mp4)

![A chess board, event propagator, and spreadsheet syncing across windows.](chess.mp4)

## Adversarial Embedding

_Adversarial embedding_ is the approach of decoupling live programming systems from a specific host environment, like a top-level domain or desktop application. This makes it possible to situate them across a wider range of environments and compose them side-by-side with other systems. To achieve this, coordination via protocols is necessary.

Web applets [^10] are one such protocol that web-based, live programming system can use to achieve adversarial embedding. Through a small event-based protocol that wraps around an `iframe`, web applets provide a means for any existing web page to externalize state and actions to a host environment. It doesn't require any changes to how these existing systems are designed, packaged, or distributed. The downside with this protocol is that information hiding remains the default, the author(s) of the system remain in full control of what is addressable and what is not. While some systems may find this necessary to preserve the liveness of the existing system.

The alternative is to embed freely addressable systems, which lessens the coordination required and provides more compelling forms of extensibility. For example, if the addressable space is the DOM, then a fully addressable system can be implemented as custom HTML elements. We demonstrate below an HTML-first spreadsheet where the spreadsheet and each of the cells in it are addressable by their own HTML element. The state of the running system is exposed through the DOM, each cell has properties for its evaluated value and dependencies. Furthermore, each cell emits a DOM event when it is re-evaluated, meaning that dependents can listen to re-evaluate themselves, but also that granular observability from outside of the spreadsheet is possible. Another benefit of addressability shown in this demo is that any part of the system can be styled via CSS. All of this together means that it's possible to take this system and permisionlessly amend it with an in-place visualization of the spreadsheet's dependency graph all while the system continues running.

![A spreadsheet with a custom HTML element that exposes its state and dependencies.](spreadsheet.mp4)

## Adversarial Extension

When existing systems provide no addressable surfaces, adversarial extension creates addressability by exploiting whatever infrastructure remains available. Unlike annotation, which works with systems designed to tolerate additions, extension operates on closed systems by repurposing infrastructure that was never intended to support live programming.

Accessibility APIs represent one such exploitable infrastructure. Operating systems expose accessibility trees to support assistive technologies, creating a parallel addressable representation of every running application's interface. Our prototype demonstrates how this infrastructure can be repurposed for live programming interventions—a WebSocket server connects web interfaces to accessibility and windowing APIs, making it possible to query, subscribe to, and modify the interface state of any running application. This creates an addressable surface where none existed before.

The accessibility tree prototype shows the Signal messaging application with an outline view of its accessibility tree. This view is rendered on top of all running applications, allowing arbitrary web-based interfaces to be rendered alongside (or on top of) a running application which can provide alternative interfaces to interact with the interface state. By exploiting the accessibility infrastructure that applications cannot opt out of—since doing so would break assistive technology compliance—this approach works even with systems designed to resist external intervention. These extensions succeed through infrastructural appropriation, using addressing schemes intended for assistive technology to enable new forms of programmatic interaction.

![A Signal app with an editable accessibility tree.](axtree.png)

# Related Work

Systems like Sifter [^11], Vegimite [^12], Rousillon [^13], Wildcard [^14], and Joker [^15] demonstrate a form of adversarial embedding. They enable end-users to customize existing web pages by scraping data into spreadsheets and tables, then reflecting modifications back to the original page. By packaging themselves as web extensions rather than standalone applications, these systems situate themselves inside the environments they augment rather than requiring users to bring their data elsewhere.

Whereas the systems above try abstract away web technologies behind familiar interfaces, Webstrates [^16] takes the opposite approach, creating a collaborative authoring environment where "the state of the DOM itself corresponds to the authorial shared state" [^8]. Webstrates demonstrates the potential of exploiting the DOM's inherent addressability as a foundation for live programming in shared authorial environments. Our DOM sync attribute explores similar territory, enabling computational annotation of existing DOM structures without requiring migration to a dedicated platform.

Engraft [^17] explores composition between live programming tools by creating interfaces that allow different systems to be embedded within each other. While Engraft acknowledges that live programming systems should integrate with the outside world, its focus on inward composition—maintaining properties within controlled environments—contrasts with our emphasis on outward integration into hostile territory.

# Discussion

When users experience live programming capabilities situated in place rather than sequestered in dedicated environments, we hope they begin to see such integration as normal rather than exceptional. We believe pluralistic practices that subvert intended boundaries create pressure like water finding cracks — persistent forces that gradually reshape systems toward openness.

Much of live programming research focuses on creating better environments without considering how change actually happens in computing ecosystems. We believe the community needs to engage with the question of _change_: how do isolated programming tools evolve into integrated, composable ecologies without falling into success-by-domination strategies? Our approach rests on the belief that fragile bridges and adversarial interventions create social pressures that drive systemic change. By demonstrating what becomes possible when addressable surfaces are exploited, we establish expectations of interoperability and integration. These prototypes point toward a future where external composition is a design assumption rather than an afterthought.

The scale of this challenge becomes clear when we consider how difficult it is to depart from existing traditions. Plaintext infrastructures resist single-system dominance, but this resistance was not inevitable. As Hall observes, what we call "plaintext infrastructure" is actually "the set of text encoding, display, manipulation, and processing artifacts currently ubiquitous in computing: ASCII, UTF8, text editors, text-field or text-area UI widgets, terminals, keyboards, String types, object-to-String rendering functions, human-readable format libraries, tokenizers, parsers, escape sequences and input sanitization, Base64 encoding, line-ending and whitespace conventions, and the fallback data-flavor of the copy/paste clipboard" [^4]. This ubiquity required decades of standardization, adoption, and gradual convergence—it did not emerge from any inherent philosophical commitment to openness. The challenge is achieving similar ubiquity for live programming systems.

# Limitations & Future Work

Our current exploration focuses on additive modifications and does not address removing or replacing parts of running programs. The approaches we present also concentrate heavily on UI-level intervention points. Significant work remains in applying adversarial techniques at other levels of the software stack, from runtime systems to operating system primitives. Kell's work on liballocs suggests one promising direction for free addressability at the process level [^18].

Most of our examples target web and browser contexts, limiting their applicability to the broader software ecosystem. Future work should explore how these strategies translate to desktop applications, mobile environments, and system-level software. The fragility of some approaches—such as relying on unstable CSS selectors or working around obfuscated DOM structures—highlights the need for more robust addressing schemes.

An important direction for future research involves enabling interoperability and co-existence between different live programming models that may have conflicting guarantees or execution models. What primitives enable different computational paradigms to work together? These questions become urgent as we move toward ecosystems where multiple live programming systems must coexist and collaborate.

Perhaps most ambitiously, we envision extending these principles to operating system design. What would it look like if accessibility trees provided stable, rich addressing schemes for all running applications? How might we design OS-level APIs that assume external composition rather than treating it as an afterthought?

# References

[^1]: P. Rein, S. Ramson, J. Lincke, R. Hirschfeld, and T. Pape, “Exploratory and Live, Programming and Coding: A Literature Study Comparing Perspectives on Liveness,” The Art, Science, and Engineering of Programming, vol. 3, no. 1, Jul. 2018, doi: 10.22152/programming-journal.org/2019/3/1.

[^2]: C. Clark and A. Basman, “Tracing a Paradigm for Externalization: Avatars and the GPII Nexus,” 2017.

[^3]: S. Kell, “Convivial Design Heuristics for Software Systems,” in Conference Companion of the 4th International Conference on Art, Science, and Engineering of Programming, Porto Portugal: ACM, Mar. 2020, pp. 144–148. doi: 10.1145/3397537.3397543.

[^4]: C. Hall, “Rethinking the Human Readability Infrastructure,” in Proceedings of the Workshop on Future Programming, in FPW 2015. New York, NY, USA: Association for Computing Machinery, Oct. 2015, pp. 1–6. doi: 10.1145/2846656.2846657.

[^5]: C. Shank and O. Reed, “Folkjs.” Accessed: Jul. 22, 2025. [Online]. Available: https://folkjs.org/

[^6]: P. Tchernavskij, “Designing and Programming Malleable Software,” 2019.

[^7]: K. Ostermann, P. G. Giarrusso, C. Kästner, and T. Rendel, “Revisiting Information Hiding: Reflections on Classical and Nonclassical Modularity,” in Proceedings of the 25th European Conference on Object-oriented Programming, in ECOOP'11. Berlin, Heidelberg: Springer-Verlag, Jul. 2011, pp. 155–178.

[^8]: A. Basman, C. Lewis, and C. Clark, “The Open Authorial Principle: Supporting Networks of Authors in Creating Externalisable Designs,” in Proceedings of the 2018 ACM SIG-PLAN International Symposium on New Ideas, New Paradigms, and Reflections on Programming and Software, in Onward! 2018. New York, NY, USA: Association for Computing Machinery, Oct. 2018, pp. 29–43. doi: 10.1145/3276954.3276963.

[^9]: C. Doctorow, “Adversarial Interoperability.” Accessed: Aug. 09, 2020. [Online]. Available: https://www.eff.org/deeplinks/2019/10/adversarial-interoperability

[^10]: M. Rupert and V. Steven, “Unternet-Co/Web Applets.” Accessed: Jul. 21, 2025. [Online]. Available: https:// github.com/unternet-co/web-applets

[^11]: D. F. Huynh, R. C. Miller, and D. R. Karger, “Enabling Web Browsers to Augment Web Sites' Filtering and Sorting Functionalities,” in Proceedings of the 19th Annual ACM Symposium on User Interface Software and Technology, Montreux Switzerland: ACM, Oct. 2006, pp. 125–134. doi: 10.1145/1166253.1166274.

[^12]: J. Lin, J. Wong, J. Nichols, A. Cypher, and T. A. Lau, “End-User Programming of Mashups with Vegemite,” in Proceedings of the 14th International Conference on Intelligent User Interfaces, Sanibel Island Florida USA: ACM, Feb. 2009, pp. 97–106. doi: 10.1145/1502650.1502667.

[^13]: S. E. Chasins, M. Mueller, and R. Bodik, “Rousillon: Scraping Distributed Hierarchical Web Data,” in Proceedings of the 31st Annual ACM Symposium on User Interface Software and Technology, Berlin Germany: ACM, Oct. 2018, pp. 963–975. doi: 10.1145/3242587.3242661.

[^14]: G. Litt and D. Jackson, “Wildcard: Spreadsheet-Driven Customization of Web Applications,” in Conference Companion of the 4th International Conference on Art, Science, and Engineering of Programming, Porto Portugal: ACM, Mar. 2020, pp. 126–135. doi: 10.1145/3397537.3397541.

[^15]: K. Katongo, G. Litt, K. Jin, and D. Jackson, “Joker: A Unified Interaction Model For Web Customization,” 2022.

[^16]: C. N. Klokmose, J. R. Eagan, S. Baader, W. Mackay, and M. Beaudouin-Lafon, “Webstrates: Shareable Dynamic Media,” in Proceedings of the 28th Annual ACM Symposium on User Interface Software & Technology, Charlotte NC USA: ACM, Nov. 2015, pp. 280–290. doi: 10.1145/2807442.2807446.

[^17]: J. Horowitz and J. Heer, “Engraft: An API for Live, Rich, and Composable Programming,” in Proceedings of the 36th Annual ACM Symposium on User Interface Software and Technology, San Francisco CA USA: ACM, Oct. 2023, pp. 1–18. doi: 10.1145/3586183.3606733.

[^18]: S. Kell, “The Inevitable Death of VMs: A Progress Report,” in Conference Companion of the 2nd International Conference on Art, Science, and Engineering of Programming, Nice France: ACM, Apr. 2018, pp. 61–62. doi: 10.1145/3191697.3191728.
