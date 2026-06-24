// *****************************************************************************
// Copyright (C) 2026 EclipseSource GmbH.
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

import { LanguageModelRegistry, LanguageModelStatus } from '@theia/ai-core';
import { Disposable, DisposableCollection } from '@theia/core';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { CopilotLanguageModelsManager, CopilotModelDescription, COPILOT_PROVIDER_ID, getCopilotApiBaseUrl, CopilotModelData } from '../common';
import { CopilotOAuthConfig } from '../common/copilot-oauth-config';
import { CopilotLanguageModel } from './copilot-language-model';
import { CopilotAnthropicLanguageModel } from './copilot-anthropic-language-model';
import { CopilotAuthServiceImpl } from './copilot-auth-service-impl';
import { OpenAiModelUtils } from '@theia/ai-openai/lib/node/openai-language-model';
import { OpenAiResponseApiUtils } from '@theia/ai-openai/lib/node/openai-response-api-utils';

interface CopilotModelResponseData {
    id: string;
    capabilities?: {
        family?: string;
        supports?: {
            structured_output?: boolean;
            reasoning_effort?: string[];
            streaming?: boolean;
        };
    };
    vendor: string;
    supported_endpoints?: string[];
};

/**
 * Backend implementation of the Copilot language models manager.
 * Manages registration and lifecycle of Copilot language models in the AI language model registry.
 */
@injectable()
export class CopilotLanguageModelsManagerImpl implements CopilotLanguageModelsManager, Disposable {

    @inject(LanguageModelRegistry)
    protected readonly languageModelRegistry: LanguageModelRegistry;

    @inject(CopilotAuthServiceImpl)
    protected readonly authService: CopilotAuthServiceImpl;

    @inject(CopilotOAuthConfig)
    protected readonly oauthConfig: CopilotOAuthConfig;

    @inject(OpenAiModelUtils)
    protected readonly openAiModelUtils: OpenAiModelUtils;

    @inject(OpenAiResponseApiUtils)
    protected readonly responseApiUtils: OpenAiResponseApiUtils;

    protected enterpriseUrl: string | undefined;
    protected readonly toDispose = new DisposableCollection();

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.authService.onAuthStateChanged(() => {
            this.refreshModelsStatus();
        }));
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    setEnterpriseUrl(url: string | undefined): void {
        this.enterpriseUrl = url;
    }

    protected async calculateStatus(): Promise<LanguageModelStatus> {
        const authState = await this.authService.getAuthState();
        if (authState.isAuthenticated) {
            return { status: 'ready' };
        }
        return { status: 'unavailable', message: 'Not signed in to GitHub Copilot' };
    }

    async createOrUpdateLanguageModels(...modelDescriptions: CopilotModelDescription[]): Promise<void> {
        const status = await this.calculateStatus();

        for (const modelDescription of modelDescriptions) {
            let existingModel = await this.languageModelRegistry.getLanguageModel(modelDescription.id);
            const isAnthropicModel = modelDescription.vendor === 'Anthropic';
            const useResponseApi = modelDescription.useResponseApi ?? false;

            if (existingModel) {
                if (!(existingModel instanceof CopilotLanguageModel) && !(existingModel instanceof CopilotAnthropicLanguageModel)) {
                    console.warn(`Copilot: model ${modelDescription.id} is not a Copilot model`);
                    continue;
                }
                if (isAnthropicModel && existingModel instanceof CopilotAnthropicLanguageModel) {
                    await this.languageModelRegistry.patchLanguageModel<CopilotAnthropicLanguageModel>(modelDescription.id, {
                        model: modelDescription.model,
                        enableStreaming: modelDescription.enableStreaming,
                        status,
                        maxRetries: modelDescription.maxRetries
                    });
                } else if (!isAnthropicModel && existingModel instanceof CopilotLanguageModel) {
                    await this.languageModelRegistry.patchLanguageModel<CopilotLanguageModel>(modelDescription.id, {
                        model: modelDescription.model,
                        enableStreaming: modelDescription.enableStreaming,
                        supportsStructuredOutput: modelDescription.supportsStructuredOutput,
                        status,
                        maxRetries: modelDescription.maxRetries
                    });
                } else {
                    // Model type has changed (e.g. from OpenAI to Claude), replace it
                    this.languageModelRegistry.removeLanguageModels([modelDescription.id]);
                    existingModel = undefined;
                }
            }
            if (!existingModel) {
                if (isAnthropicModel) {
                    this.languageModelRegistry.addLanguageModels([
                        new CopilotAnthropicLanguageModel(
                            modelDescription.id,
                            modelDescription.model,
                            status,
                            modelDescription.enableStreaming,
                            modelDescription.maxRetries,
                            () => this.authService.getAccessToken(),
                            () => this.enterpriseUrl,
                            () => this.oauthConfig.userAgent
                        )
                    ]);
                } else {
                    this.languageModelRegistry.addLanguageModels([
                        new CopilotLanguageModel(
                            modelDescription.id,
                            modelDescription.model,
                            status,
                            modelDescription.enableStreaming,
                            modelDescription.supportsStructuredOutput,
                            modelDescription.maxRetries,
                            this.openAiModelUtils,
                            this.responseApiUtils,
                            useResponseApi,
                            () => this.authService.getAccessToken(),
                            () => this.enterpriseUrl,
                            () => this.oauthConfig.userAgent
                        )
                    ]);
                }
            }
        }
    }

    removeLanguageModels(...modelIds: string[]): void {
        this.languageModelRegistry.removeLanguageModels(modelIds);
    }

    async refreshModelsStatus(): Promise<void> {
        const status = await this.calculateStatus();
        const allModels = await this.languageModelRegistry.getLanguageModels();

        for (const model of allModels) {
            if ((model instanceof CopilotLanguageModel || model instanceof CopilotAnthropicLanguageModel)
                && model.id.startsWith(`${COPILOT_PROVIDER_ID}/`)) {
                await this.languageModelRegistry.patchLanguageModel<CopilotLanguageModel>(model.id, {
                    status
                });
            }
        }
    }

    async fetchAvailableModels(): Promise<CopilotModelData[]> {
        const models = await this.internalFetchAvailableModels();
        return models.map(m => ({
            id: m.id,
            useResponseApi: m.supported_endpoints?.includes('/responses'),
            vendor: m.vendor,
            supportsStructuredOutput: m.capabilities?.supports?.structured_output,
            supportsReasoning: (m.capabilities?.supports?.reasoning_effort?.length ?? 0) > 0,
            supportsStreaming: m.capabilities?.supports?.streaming
        }));
    }

    private async internalFetchAvailableModels(): Promise<CopilotModelResponseData[]> {
        const accessToken = await this.authService.getAccessToken();
        if (!accessToken) {
            return [];
        }

        const baseURL = getCopilotApiBaseUrl(this.enterpriseUrl);

        try {
            const response = await fetch(`${baseURL}/models`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': this.oauthConfig.userAgent,
                    'Copilot-Integration-Id': 'vscode-chat',
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn(`Copilot: failed to fetch available models: ${response.status} ${response.statusText}`);
                return [];
            }

            const data = await response.json() as {
                data?: Array<CopilotModelResponseData>;
            };
            // eslint-disable-next-line no-null/no-null
            console.log('response data', JSON.stringify(data, null, 2));
            const models = data.data ?? [];
            const deduplicatedModels = this.deduplicateModels(models);
            console.log(`Copilot: discovered ${deduplicatedModels.length} available models: ${deduplicatedModels.map(m => m.id).join(', ')}`);
            return deduplicatedModels;
        } catch (error) {
            console.warn('Copilot: failed to fetch available models:', error);
            return [];
        }
    }

    /**
     * Deduplicates models returned by the Copilot API.
     * The API returns both alias IDs (e.g., `gpt-4o`) and versioned IDs
     * (e.g., `gpt-4o-2024-11-20`) for the same model family.
     * We keep only the family alias when it exists, falling back to
     * the versioned ID otherwise.
     */
    protected deduplicateModels(models: Array<CopilotModelResponseData>): CopilotModelResponseData[] {
        const allIds = new Map<string, CopilotModelResponseData>(models.map(m => [m.id, m]));
        const result: CopilotModelResponseData[] = [];
        const seenFamilies = new Map<string, CopilotModelResponseData>();

        for (const model of models) {
            const family = model.capabilities?.family;
            if (family && seenFamilies.has(family)) {
                continue;
            }
            if (family) {
                seenFamilies.set(family, model);
                // Prefer the family alias if it exists as a model ID
                if (allIds.has(family)) {
                    result.push(allIds.get(family)!);
                } else {
                    result.push(model);
                }
            } else {
                result.push(model);
            }
        }

        return result;
    }
}
