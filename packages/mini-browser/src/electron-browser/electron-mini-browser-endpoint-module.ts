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
import { MiniBrowserService } from '../common/mini-browser-service';
import { LocationMapper } from '../browser/location-mapper-service';
import { ElectronMiniBrowserService } from './electron-mini-browser-service';
import { ElectronLocationWithoutSchemeMapper, ElectronFileLocationMapper } from './electron-mini-browser-location-mapper';

/**
 * We do not setup a JSON-RPC service when using Electron. We will load files directly from disk.
 */

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    bind(MiniBrowserService).to(ElectronMiniBrowserService).inSingletonScope();
    bind(LocationMapper).to(ElectronLocationWithoutSchemeMapper).inSingletonScope();
    bind(LocationMapper).to(ElectronFileLocationMapper).inSingletonScope();
});
