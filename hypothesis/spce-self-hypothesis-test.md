# Self serve tool: Does data support my hypothesis?

I'd like to build a tool to help city officials who have recently made changes to environments, procedures or staffing in response to resident coplaints. The users may have done something like trimmed trees and installed new lighting around a park because nearby residents were complaining about drug activity. This tool should help them see if there is any evidence in the SF OpenData to support whether their changes had the desired effect.

Below are the inputs and outputs the tool would use and provide along with a real world example of Koshland park environmental interventions.

## We would ask for the following inputs
- What did we do?
    - We made improvements to sight lines via new lighting and tree trimming
- Where did we do it?
    - Koshland park (drop pin)
- When did it happen?
    - 5/13
- What do we expect to change
    - reduce drug related activity complaints



## The tool would provide the following outputs
- Clear answer to whether their hypothesis is supported by data or not
    - No
- Bar chart of very nearby complaints over time
- All complaint locations on map, rollover for full details

## Tech to use

Let's make this as simple as possible, do not use large frontend framework like react unless absolutely necessary. I like the Web Awesome component set. Use their MCP server for details on how to use those effectively.

Use leaflet for maps

Any charting solution is fine, want to make lightweight choices, if we need D3 and can include it with minimal dependency size that is cool

## Design

Use the design style similar to https://resultsfor.sf.gov/ I don't want to duplicate their tech stack unless it meets our lean requirements.

## Data evaluation

I want to provide guardrails around types of hypothesis based on prior work we've done to identify the most useful data points. For example out of all 311, 911 and SFPD data the most relevant item is: 911 calls for service with the string "DRUGS" as part of the Notes field.

There will need to be an AI endpoint integrated that will do a final synthesis and give plain language summary but the data queries of the SF Open Data should all be pre built into the tool so that the appropriate charts, maps can be built programatically without calling AI.

## Scope

A future version of the tool could allow tweaking of parameters for type of data point measured, area included in evaluation but we don't need to build this in the initial prototype