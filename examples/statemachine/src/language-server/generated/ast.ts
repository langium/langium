/******************************************************************************
 * This file was generated by langium-cli 3.0.1.
 * DO NOT EDIT MANUALLY!
 ******************************************************************************/

/* eslint-disable */
import type { AstNode, Reference, ReferenceInfo, TypeMetaData } from 'langium';
import { AbstractAstReflection } from 'langium';

export const StatemachineTerminals = {
    WS: /\s+/,
    ID: /[_a-zA-Z][\w_]*/,
    ML_COMMENT: /\/\*[\s\S]*?\*\//,
    SL_COMMENT: /\/\/[^\n\r]*/,
};

export interface Command extends AstNode {
    readonly $container: Statemachine;
    readonly $type: 'Command';
    name: string;
}

export const Command = 'Command';

export function isCommand(item: unknown): item is Command {
    return reflection.isInstance(item, Command);
}

export interface Event extends AstNode {
    readonly $container: Statemachine;
    readonly $type: 'Event';
    name: string;
}

export const Event = 'Event';

export function isEvent(item: unknown): item is Event {
    return reflection.isInstance(item, Event);
}

export interface State extends AstNode {
    readonly $container: Statemachine;
    readonly $type: 'State';
    actions: Array<Reference<Command>>;
    name: string;
    transitions: Array<Transition>;
}

export const State = 'State';

export function isState(item: unknown): item is State {
    return reflection.isInstance(item, State);
}

export interface Statemachine extends AstNode {
    readonly $type: 'Statemachine';
    commands: Array<Command>;
    events: Array<Event>;
    init: Reference<State>;
    name: string;
    states: Array<State>;
}

export const Statemachine = 'Statemachine';

export function isStatemachine(item: unknown): item is Statemachine {
    return reflection.isInstance(item, Statemachine);
}

export interface Transition extends AstNode {
    readonly $container: State;
    readonly $type: 'Transition';
    event: Reference<Event>;
    state: Reference<State>;
}

export const Transition = 'Transition';

export function isTransition(item: unknown): item is Transition {
    return reflection.isInstance(item, Transition);
}

export type StatemachineAstType = {
    Command: Command
    Event: Event
    State: State
    Statemachine: Statemachine
    Transition: Transition
}

export class StatemachineAstReflection extends AbstractAstReflection {

    getAllTypes(): string[] {
        return ['Command', 'Event', 'State', 'Statemachine', 'Transition'];
    }

    protected override computeIsSubtype(subtype: string, supertype: string): boolean {
        switch (subtype) {
            default: {
                return false;
            }
        }
    }

    getReferenceType(refInfo: ReferenceInfo): string {
        const referenceId = `${refInfo.container.$type}:${refInfo.property}`;
        switch (referenceId) {
            case 'State:actions': {
                return Command;
            }
            case 'Statemachine:init':
            case 'Transition:state': {
                return State;
            }
            case 'Transition:event': {
                return Event;
            }
            default: {
                throw new Error(`${referenceId} is not a valid reference id.`);
            }
        }
    }

    getTypeMetaData(type: string): TypeMetaData {
        switch (type) {
            case 'Command': {
                return {
                    name: 'Command',
                    properties: [
                        { name: 'name' }
                    ]
                };
            }
            case 'Event': {
                return {
                    name: 'Event',
                    properties: [
                        { name: 'name' }
                    ]
                };
            }
            case 'State': {
                return {
                    name: 'State',
                    properties: [
                        { name: 'actions', defaultValue: [] },
                        { name: 'name' },
                        { name: 'transitions', defaultValue: [] }
                    ]
                };
            }
            case 'Statemachine': {
                return {
                    name: 'Statemachine',
                    properties: [
                        { name: 'commands', defaultValue: [] },
                        { name: 'events', defaultValue: [] },
                        { name: 'init' },
                        { name: 'name' },
                        { name: 'states', defaultValue: [] }
                    ]
                };
            }
            case 'Transition': {
                return {
                    name: 'Transition',
                    properties: [
                        { name: 'event' },
                        { name: 'state' }
                    ]
                };
            }
            default: {
                return {
                    name: type,
                    properties: []
                };
            }
        }
    }
}

export const reflection = new StatemachineAstReflection();
