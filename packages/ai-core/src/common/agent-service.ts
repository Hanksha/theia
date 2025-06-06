// *****************************************************************************
// Copyright (C) 2024 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import { Agent } from './agent';
import { AISettingsService } from './settings-service';
import { PromptService } from './prompt-service';

export const AgentService = Symbol('AgentService');

/**
 * Service to access the list of known Agents.
 */
export interface AgentService {
    /**
     * Retrieves a list of all available agents, i.e. agents which are not disabled
     */
    getAgents(): Agent[];
    /**
     * Retrieves a list of all agents, including disabled ones.
     */
    getAllAgents(): Agent[];
    /**
     * Enable the agent with the specified id.
     * @param agentId the agent id.
     */
    enableAgent(agentId: string): void;
    /**
     * disable the agent with the specified id.
     * @param agentId the agent id.
     */
    disableAgent(agentId: string): void;
    /**
     * query whether this agent is currently enabled or disabled.
     * @param agentId the agent id.
     * @return true if the agent is enabled, false otherwise.
     */
    isEnabled(agentId: string): boolean;

    /**
     * Allows to register an agent programmatically.
     * @param agent the agent to register
     */
    registerAgent(agent: Agent): void;

    /**
     * Allows to unregister an agent programmatically.
     * @param agentId the agent id to unregister
     */
    unregisterAgent(agentId: string): void;

    /**
     * Emitted when the list of agents changes.
     * This can be used to update the UI when agents are added or removed.
     */
    onDidChangeAgents: Event<void>;
}

@injectable()
export class AgentServiceImpl implements AgentService {

    @inject(AISettingsService) @optional()
    protected readonly aiSettingsService: AISettingsService | undefined;

    @inject(PromptService)
    protected readonly promptService: PromptService;

    protected disabledAgents = new Set<string>();

    protected _agents: Agent[] = [];

    private readonly onDidChangeAgentsEmitter = new Emitter<void>();
    readonly onDidChangeAgents = this.onDidChangeAgentsEmitter.event;

    @postConstruct()
    protected init(): void {
        this.aiSettingsService?.getSettings().then(settings => {
            Object.entries(settings).forEach(([agentId, agentSettings]) => {
                if (agentSettings.enable === false) {
                    this.disabledAgents.add(agentId);
                }
            });
        });
    }

    registerAgent(agent: Agent): void {
        this._agents.push(agent);
        agent.prompts.forEach(
            prompt => {
                this.promptService.addBuiltInPromptFragment(prompt.defaultVariant, prompt.id, true);
                prompt.variants?.forEach(variant => {
                    this.promptService.addBuiltInPromptFragment(variant, prompt.id);
                });
            }
        );
        this.onDidChangeAgentsEmitter.fire();
    }

    unregisterAgent(agentId: string): void {
        const agent = this._agents.find(a => a.id === agentId);
        this._agents = this._agents.filter(a => a.id !== agentId);
        this.onDidChangeAgentsEmitter.fire();
        agent?.prompts.forEach(
            prompt => {
                this.promptService.removePromptFragment(prompt.defaultVariant.id);
                prompt.variants?.forEach(variant => {
                    this.promptService.removePromptFragment(variant.id);
                });
            }
        );
    }

    getAgents(): Agent[] {
        return this._agents.filter(agent => this.isEnabled(agent.id));
    }

    getAllAgents(): Agent[] {
        return this._agents;
    }

    enableAgent(agentId: string): void {
        this.disabledAgents.delete(agentId);
        this.aiSettingsService?.updateAgentSettings(agentId, { enable: true });
    }

    disableAgent(agentId: string): void {
        this.disabledAgents.add(agentId);
        this.aiSettingsService?.updateAgentSettings(agentId, { enable: false });
    }

    isEnabled(agentId: string): boolean {
        return !this.disabledAgents.has(agentId);
    }
}
