/********************************************************************************
 * Copyright (C) 2020 Ericsson and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { ContainerModule } from 'inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { MiniBrowserService, MiniBrowserServicePath } from '../common/mini-browser-service';
import { LocationMapper, FileLocationMapper, LocationWithoutSchemeMapper } from './location-mapper-service';

/**
 * When running in the Browser, we will open files via a remote HTTP server (Theia's Backend).
 */

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    bind(LocationMapper).to(FileLocationMapper).inSingletonScope();
    bind(LocationWithoutSchemeMapper).toSelf().inSingletonScope();
    bind(LocationMapper).toService(LocationWithoutSchemeMapper);
    bind(MiniBrowserService).toDynamicValue(context => WebSocketConnectionProvider.createProxy(context.container, MiniBrowserServicePath)).inSingletonScope();
});
