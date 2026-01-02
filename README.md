# nodeticket
A nodejs server that is orthogonal to Osticket.

## Premises

* Connects to existing Osticket databases
* Initially supports v1.8 ~ will investigate backwardedness


## Core Concepts

### Actors
* Customers
* Staff
* Agents
  * the silent bureaucrats who enforce rules and route work
  * could be algorithmic or intelligent
* Administrators
  * define and configure the system

### Actions
* create ticket
* classify & categorize a ticket
* assign a ticket
* communicate
  * add external/internal messages
  * change the status of a ticket
* close a ticket

### Entities 
* Tickets
* Users
* Messages
