// Everything one MCP request needs to act as the signed-in person: their ID
// token, a Firestore client, and memoized reads so several lookups within a
// request don't fetch the same group twice.

import type { Group } from '../../src/types';
import { Firestore } from './firestore';
import { idTokenFor, type Env, type Props } from './token';
import { listMyGroups, loadGroupData, type GroupData } from './group';

export interface Session {
  uid: string;
  db(): Promise<Firestore>;
  /** My name as the app shows it (users/{uid}.name), if set */
  myName(): Promise<string | undefined>;
  groups(): Promise<Group[]>;
  groupData(group: Group): Promise<GroupData>;
}

export function createSession(env: Env, props: Props, fetchFn: typeof fetch = fetch): Session {
  let db: Promise<Firestore> | undefined;
  let groups: Promise<Group[]> | undefined;
  let name: Promise<string | undefined> | undefined;
  const data = new Map<string, Promise<GroupData>>();

  const session: Session = {
    uid: props.uid,
    db: () => (db ??= idTokenFor(env, props, fetchFn).then(idToken => new Firestore({
      projectId: env.FIREBASE_PROJECT_ID,
      idToken,
      emulatorHost: env.FIRESTORE_EMULATOR_HOST,
      fetch: fetchFn,
    }))),
    myName: () => (name ??= session.db()
      .then(d => d.get(`users/${props.uid}`))
      .then(doc => (typeof doc?.name === 'string' && doc.name) || props.name)
      .catch(() => props.name)),
    groups: () => (groups ??= session.db().then(d => listMyGroups(d, props.uid))),
    groupData: (group) => {
      let p = data.get(group.id);
      if (!p) data.set(group.id, p = session.db().then(d => loadGroupData(d, group)));
      return p;
    },
  };
  return session;
}
