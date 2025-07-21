---
title: Scoped Propagators
description: A programming model for spatial canvases
date: 2024-07-08
---

> [live demo](https://orionreed.github.io/scoped-propagators/) | [talk @ LIVE/SPLASH](https://www.youtube.com/live/4GOeYylCMJI?t=29591s) | [folkjs event propagators](https://folkjs.org/canvas/propagators/event-propagators.html)

## Abstract

Graphs, as a model of computation and as a means of interaction and authorship, have found success in specific domains such as shader programming and signal processing. In these systems, computation is often expressed on nodes of specific types, with edges representing the flow of information. This is a powerful and general-purpose model, but is typically a closed-world environment where both node and edge types are decided at design-time. By choosing an alternate topology where computation is represented by edges, the incentive for a closed environment is reduced.

I present _Scoped Propagators (SPs)_, a programming model designed to be embedded within existing environments and user interfaces. By representing computation as mappings between nodes along edges, SPs make it possible to add behaviour and interactivity to environments which were not designed with liveness in mind. I demonstrate an implementation of the SP model in an infinite canvas environment, where users can create arrows between arbitrary shapes and define SPs as Javascript object literals on these arrows.

![examples](examples.mp4)

## Introduction

A scoped propagator is formed of a function which takes a _source_ and _target_ node and returns an partial update to the _target_ node, and a scope which defines some subset of events which trigger propagation.

the Scoped Propagator model is based on two key insights:

1. by representing computation as mappings between nodes along edges, you do not need to know at design-time what node types exist.
2. by scoping the propagation to events, you can augment nodes with interactive behaviour suitable for the environment in which SPs have been embedded.

Below are the four event scopes which are currently implemented, which I have found to be appropriate and useful for an infinite canvas environment.

| Scope            | Firing Condition                               |
| ---------------- | ---------------------------------------------- |
| change (default) | Properties of the source node change           |
| click            | A source node is clicked                       |
| tick             | A tick (frame render) event fires              |
| geo              | A node changes whose bounds overlap the target |

The syntax for SPs in this implementation is a _scope_ followed by a _JS object literal_:

```js
scope { property1: value1, property2: value2 }
```

Each propagator is passed the _source_ and _target_ nodes (named "from" and "to" for brevity) which can be accessed like so:

```ts
click {x: from.x + 10, rotation: to.rotation + 1 }
```

The propagator above will, when the source is clicked, set the targets `x` value to be 10 units greater than the source, and increment the targets rotation. Here is an example of this basic idea:

![intro](intro.mp4)

## Demonstration

By passing the target as well as the source node, it makes it trivial to create toggles and counters. We can do this by creating an arrow from a node _to itself_ and getting a value from either the source or target nodes (which are now the same).

Note that by allowing nodes from `self -> self` we do not have to worry about the layout of nodes, as the arrow will move wherever the node moves. This is in contrast to, for example, needing to move a button node alongside the node of interest, or have some suitable grouping primitive available.

![buttons](buttons.mp4)

This is already sufficient for many primitive constraint-based layouts, with the caveat that constraints do not, without the addition of a backwards propagator, work in both directions.

![constraints](constraints.mp4)

Being able to take a property from one node, transform it, and set the property of another node to that value, is useful not just for adding behaviour but also for debugging. Here we are formatting the full properties of one node and setting the text property of the target whenever the source updates.

![inspection](inspection.mp4)

If we wish to create dynamic behaviours as a function of time, we can use an appropriate scope such as `tick` and pass a readonly `deltaTime` value to these propagators. Which here we are using to implement a classic linear interpolation equation.

Note that, as with all of the examples, 100% of the behaviour is encoded in the text of the arrows. This creates a kind of diagrammatic specification of behaviour, where all behaviours could be re-created from a static screenshot.

![lerp](lerp.mp4)

While pure functions make reasoning about a system of SPs easier, we may in practice want to allow side effects. Here we have extended the syntax to support arbitrary Javascript:

```ts
scope () {
  /* arbitrary JS can be executed in this function body */

  // optional return:
  return { /* update */ }
}
```

This is useful if we want to, for example, create utilities or DIY tools out of existing nodes, such as this "paintbrush" which creates a new shape at the top-left corner whenever the brush is not overlapping with another shape.

![tools](tools.mp4)

Scoped Propagators are interesting in part because of their ability to cross the boundaries of otherwise siloed systems and to do so without the use of an escape hatch — all additional behaviour happens in-situ, in the same environment as the interface elements, not from editing source code.

Here is an example of a Petri Net (left box) which is being mapped to a chart primitive (right box). By merit of knowing some specifics of both systems, an author can create a mapping from one to the other without any explicit relationship existing prior to the creation of the propagator (here mapping the number of tokens in a box to the height of a rectangle in a chart)

> NOTE: the syntax here is slightly older and not consistent with the other examples.

![bridging systems](bridging.mov)

Let's now combine some of these examples to create something less trivial. In this example, we have:

- a joystick (constrained to a box)
- fish movement controlled by the joystick, based on the red circles position relative to the center of the joystick box
- a shark with a fish follow behaviour
- an on/off toggle
- a dead state, which resets the score, and swaps the fish image source to a dead fish
- a score counter which increments over time for as long as the fish is alive

This small game consists of nine relatively terse arrows, propagating between nodes of different types. Propagators were also used to build the game, as it was unclear if or how I could change an image source URL until I used a propagator to inspect the internal state of the image and discovered the property to change.

![game](game.mp4)

## Prior Work

Scoped Propagators are related to [Propagator Networks](https://dspace.mit.edu/handle/1721.1/54635) but differ in three key ways:

- propagation happens along _edges_ instead of _nodes_
- propagation is only fired when to a scope condition is met.
- instead of stateful _cell nodes_ and _propagator nodes_, all nodes can be stateful and can be of an arbitrary type

This is also not the first application of propagators to infinite canvas environments, [Dennis Hansen](https://x.com/dennizor/status/1793389346881417323) built [Holograph](https://www.holograph.so), an implementation of propagator networks in [tldraw](https://tldraw.com), and motivated the use of the term "propagator" in this model.

## Open Questions

Many questions about this model have yet to be answered including questions of _function reuse_, modeling of _side-effects_, handling of _multi-input-multi-output_ propagation (which is trivial in traditional propagator networks), and applications to other domains such as graph-databases.

This model has not yet been formalised, and while the propagators themselves can be simply expressed as a function $f(a,b) \mapsto b'$, I have not yet found an appropriate way to express _scopes_ and the relationship between the two.

These questions, along with formalisation of the model and an examination of real-world usage is left to future work.
