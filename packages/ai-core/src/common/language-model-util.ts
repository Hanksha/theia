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

import {
    isLanguageModelParsedResponse,
    isLanguageModelStreamResponse,
    isLanguageModelTextResponse,
    isTextResponsePart,
    LanguageModelResponse,
    ToolRequest
} from './language-model';
import { LanguageModelMonitoredStreamResponse } from './language-model-interaction-model';

/**
 * Retrieves the text content from a `LanguageModelResponse` object.
 *
 * **Important:** For stream responses, the stream can only be consumed once. Calling this function multiple times on the same stream response will return an empty string (`''`)
 * on subsequent calls, as the stream will have already been consumed.
 *
 * @param {LanguageModelResponse} response - The response object, which may contain a text, stream, or parsed response.
 * @returns {Promise<string>} - A promise that resolves to the text content of the response.
 * @throws {Error} - Throws an error if the response type is not supported or does not contain valid text content.
 */
export const getTextOfResponse = async (response: LanguageModelResponse | LanguageModelMonitoredStreamResponse): Promise<string> => {
    if (isLanguageModelTextResponse(response)) {
        return response.text;
    } else if (isLanguageModelStreamResponse(response)) {
        let result = '';
        for await (const chunk of response.stream) {
            result += (isTextResponsePart(chunk) && chunk.content) ? chunk.content : '';
        }
        return result;
    } else if (isLanguageModelParsedResponse(response)) {
        return response.content;
    } else if ('parts' in response) {
        // Handle monitored stream response
        let result = '';
        for (const chunk of response.parts) {
            result += (isTextResponsePart(chunk) && chunk.content) ? chunk.content : '';
        }
        return result;
    }
    throw new Error(`Invalid response type ${response}`);
};

export const getJsonOfResponse = async (response: LanguageModelResponse | LanguageModelMonitoredStreamResponse): Promise<unknown> => {
    const text = await getTextOfResponse(response);
    return getJsonOfText(text);
};

export const getJsonOfText = (text: string): unknown => {
    if (text.startsWith('```json')) {
        const regex = /```json\s*([\s\S]*?)\s*```/g;
        let match;
        // eslint-disable-next-line no-null/no-null
        while ((match = regex.exec(text)) !== null) {
            try {
                return JSON.parse(match[1]);
            } catch (error) {
                console.error('Failed to parse JSON:', error);
            }
        }
    } else if (text.startsWith('{') || text.startsWith('[')) {
        return JSON.parse(text);
    }
    throw new Error('Invalid response format');
};

export const toolRequestToPromptText = (toolRequest: ToolRequest): string => `${toolRequest.id}`;
