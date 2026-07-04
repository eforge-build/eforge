/**
 * Typed helpers for agent runtime profile management daemon API endpoints.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES, buildPath, buildProfileListPath } from '../routes.js';
import type {
  ProfileListRequest,
  ProfileListResponse,
  ProfileShowResponse,
  ProfileUseRequest,
  ProfileUseResponse,
  ProfileCreateRequest,
  ProfileCreateResponse,
  ProfileDeleteRequest,
  ProfileDeleteResponse,
} from '../types.js';

export function apiListProfiles(opts: { cwd: string; query?: ProfileListRequest }) {
  return daemonRequest<ProfileListResponse>(opts.cwd, 'GET', buildProfileListPath(opts.query));
}

export function apiShowProfile(opts: { cwd: string }) {
  return daemonRequest<ProfileShowResponse>(opts.cwd, 'GET', API_ROUTES.profileShow);
}

export function apiUseProfile(opts: { cwd: string; body: ProfileUseRequest }) {
  return daemonRequest<ProfileUseResponse>(opts.cwd, 'POST', API_ROUTES.profileUse, opts.body);
}

export function apiCreateProfile(opts: { cwd: string; body: ProfileCreateRequest }) {
  return daemonRequest<ProfileCreateResponse>(opts.cwd, 'POST', API_ROUTES.profileCreate, opts.body);
}

export function apiDeleteProfile(opts: { cwd: string; name: string; body?: ProfileDeleteRequest }) {
  return daemonRequest<ProfileDeleteResponse>(
    opts.cwd,
    'DELETE',
    buildPath(API_ROUTES.profileDelete, { name: opts.name }),
    opts.body,
  );
}

export function apiListProfilesIfRunning(opts: { cwd: string; query?: ProfileListRequest }) {
  return daemonRequestIfRunning<ProfileListResponse>(opts.cwd, 'GET', buildProfileListPath(opts.query));
}

export function apiShowProfileIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<ProfileShowResponse>(opts.cwd, 'GET', API_ROUTES.profileShow);
}

export function apiUseProfileIfRunning(opts: { cwd: string; body: ProfileUseRequest }) {
  return daemonRequestIfRunning<ProfileUseResponse>(opts.cwd, 'POST', API_ROUTES.profileUse, opts.body);
}

export function apiCreateProfileIfRunning(opts: { cwd: string; body: ProfileCreateRequest }) {
  return daemonRequestIfRunning<ProfileCreateResponse>(opts.cwd, 'POST', API_ROUTES.profileCreate, opts.body);
}

export function apiDeleteProfileIfRunning(opts: { cwd: string; name: string; body?: ProfileDeleteRequest }) {
  return daemonRequestIfRunning<ProfileDeleteResponse>(
    opts.cwd,
    'DELETE',
    buildPath(API_ROUTES.profileDelete, { name: opts.name }),
    opts.body,
  );
}
