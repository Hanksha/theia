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

import { AnthropicModel, DEFAULT_MAX_TOKENS } from '@theia/ai-anthropic/lib/node/anthropic-language-model';
import { LanguageModelStatus } from '@theia/ai-core';
import { Anthropic } from '@anthropic-ai/sdk';
import { getCopilotApiBaseUrl } from '../common';

/**
 * Language model implementation for GitHub Copilot using the Anthropic (Claude) API.
 * Extends AnthropicModel but authenticates via the Copilot access token and uses
 * the Copilot API base URL instead of the standard Anthropic endpoint.
 */
export class CopilotAnthropicLanguageModel extends AnthropicModel {

    constructor(
        id: string,
        model: string,
        status: LanguageModelStatus,
        enableStreaming: boolean,
        maxRetries: number,
        protected readonly accessTokenProvider: () => Promise<string | undefined>,
        protected readonly enterpriseUrlProvider: () => string | undefined,
        protected readonly userAgentProvider: () => string,
        maxTokens: number = DEFAULT_MAX_TOKENS,
    ) {
        super(
            id,
            model,
            status,
            enableStreaming,
            /* useCaching */ false,
            /* apiKey */ () => undefined,
            /* url */ undefined,
            maxTokens,
            maxRetries
        );
    }

    protected override initializeAnthropic(): Anthropic {
        throw new Error('CopilotAnthropicLanguageModel: use initializeAnthropicWithToken instead');
    }

    /**
     * Initializes the Anthropic client with a Copilot access token.
     */
    async initializeAnthropicWithToken(): Promise<Anthropic> {
        const accessToken = await this.accessTokenProvider();
        if (!accessToken) {
            throw new Error('Not authenticated with GitHub Copilot. Please sign in first.');
        }

        const baseURL = getCopilotApiBaseUrl(this.enterpriseUrlProvider());

        return new Anthropic({
            // The Copilot API uses Bearer token auth. Using authToken causes the SDK to send
            // 'Authorization: Bearer <token>' instead of the default 'x-api-key' header.
            authToken: accessToken,
            baseURL,
            defaultHeaders: {
                'User-Agent': this.userAgentProvider(),
                'Copilot-Integration-Id': 'vscode-chat'
            }
        });
    }

    override async request(
        request: Parameters<AnthropicModel['request']>[0],
        cancellationToken?: Parameters<AnthropicModel['request']>[1]
    ): ReturnType<AnthropicModel['request']> {
        if (!request.messages?.length) {
            throw new Error('Request must contain at least one message');
        }

        const anthropic = await this.initializeAnthropicWithToken();

        try {
            if (this.enableStreaming) {
                return this.handleStreamingRequest(anthropic, request, cancellationToken);
            }
            return this.handleNonStreamingRequest(anthropic, request);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(`Copilot Anthropic API request failed: ${errorMessage}`);
        }
    }
}
