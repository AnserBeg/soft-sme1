import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from '@mui/material';

interface UnsavedChangesGuardProps {
	when: boolean;
	onSave?: () => Promise<void> | void;
}

const UnsavedChangesGuard: React.FC<UnsavedChangesGuardProps> = ({ when, onSave }) => {
	console.log('[UnsavedChangesGuard] Component rendered with when=', when);
	const [open, setOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const prevHashRef = useRef<string>('');
	const pendingHashRef = useRef<string | null>(null);
	const allowNextRef = useRef<boolean>(false);

	// Intercept in-app navigations for HashRouter using capture-phase click + hashchange
	useEffect(() => {
		if (!when) return;

		prevHashRef.current = window.location.hash;
		console.log('[UnsavedChangesGuard] activating interceptors. prevHash=', prevHashRef.current);

		const isModifiedClick = (e: MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;

		const findAnchor = (el: EventTarget | null): HTMLAnchorElement | null => {
			let node = el as HTMLElement | null;
			while (node && node !== document.body) {
				if (node.tagName === 'A') return node as HTMLAnchorElement;
				node = node.parentElement;
			}
			return null;
		};

		const onClickCapture = (e: MouseEvent) => {
			if (!when || open) return;
			const anchor = findAnchor(e.target);
			if (!anchor) return;
			if (isModifiedClick(e)) return;
			const hrefAttr = anchor.getAttribute('href') || '';
			if (!hrefAttr.startsWith('#')) return; // only intercept hash links
			const targetHash = hrefAttr;
			if (targetHash === window.location.hash) return;
			// Allow one-time bypass from parent
			if ((window as any).__unsavedGuardAllowNext) {
				console.log('[UnsavedChangesGuard] bypass flag set -> allowing click navigation');
				(window as any).__unsavedGuardAllowNext = false;
				allowNextRef.current = true;
				return;
			}

			console.log('[UnsavedChangesGuard] click capture -> intercept anchor to', targetHash);
			e.preventDefault();
			e.stopPropagation();
			pendingHashRef.current = targetHash;
			setOpen(true);
		};

		const onHashChange = () => {
			if (!when) return;
			if ((window as any).__unsavedGuardAllowNext) {
				console.log('[UnsavedChangesGuard] bypass flag set -> allowing hashchange');
				(window as any).__unsavedGuardAllowNext = false;
				allowNextRef.current = true;
				prevHashRef.current = window.location.hash;
				return;
			}
			if (allowNextRef.current) {
				allowNextRef.current = false;
				prevHashRef.current = window.location.hash;
				console.log('[UnsavedChangesGuard] hashchange allowed. prevHash ->', prevHashRef.current);
				return;
			}
			if (open) return;
			const attempted = window.location.hash;
			console.log('[UnsavedChangesGuard] hashchange detected -> attempted', attempted, 'reverting to', prevHashRef.current);
			pendingHashRef.current = attempted;
			setOpen(true);
			setTimeout(() => {
				if (window.location.hash !== prevHashRef.current) {
					window.location.hash = prevHashRef.current;
				}
			}, 0);
		};


		// Intercept programmatic navigations via history.pushState/replaceState
		const originalPushState = history.pushState;
		const originalReplaceState = history.replaceState;
		(history as any).pushState = function (...args: any[]) {
			try {
				const url = args[2];
				const urlStr = typeof url === 'string' ? url : (url ? String(url) : '');
				const targetHash = urlStr && urlStr.includes('#') ? urlStr.slice(urlStr.indexOf('#')) : urlStr;
				if ((window as any).__unsavedGuardAllowNext) {
					console.log('[UnsavedChangesGuard] bypass flag set -> allowing pushState', urlStr);
					(window as any).__unsavedGuardAllowNext = false;
					allowNextRef.current = true;
					return originalPushState.apply(this, args as any);
				}
				if (when && !allowNextRef.current) {
					console.log('[UnsavedChangesGuard] pushState intercepted ->', urlStr);
					pendingHashRef.current = targetHash || null;
					setOpen(true);
					return;
				}
			} catch (e) {}
			return originalPushState.apply(this, args as any);
		};
		(history as any).replaceState = function (...args: any[]) {
			try {
				const url = args[2];
				const urlStr = typeof url === 'string' ? url : (url ? String(url) : '');
				const targetHash = urlStr && urlStr.includes('#') ? urlStr.slice(urlStr.indexOf('#')) : urlStr;
				if ((window as any).__unsavedGuardAllowNext) {
					console.log('[UnsavedChangesGuard] bypass flag set -> allowing replaceState', urlStr);
					(window as any).__unsavedGuardAllowNext = false;
					allowNextRef.current = true;
					return originalReplaceState.apply(this, args as any);
				}
				if (when && !allowNextRef.current) {
					console.log('[UnsavedChangesGuard] replaceState intercepted ->', urlStr);
					pendingHashRef.current = targetHash || null;
					setOpen(true);
					return;
				}
			} catch (e) {}
			return originalReplaceState.apply(this, args as any);
		};

		document.addEventListener('click', onClickCapture, true);
		window.addEventListener('hashchange', onHashChange);
		window.addEventListener('popstate', onHashChange);

		return () => {
			console.log('[UnsavedChangesGuard] deactivating interceptors');
			document.removeEventListener('click', onClickCapture, true);
			window.removeEventListener('hashchange', onHashChange);
			window.removeEventListener('popstate', onHashChange);
			(history as any).pushState = originalPushState;
			(history as any).replaceState = originalReplaceState;
		};
	}, [when, open]);

	// Warn on browser/tab close or refresh
	useEffect(() => {
		console.log('[UnsavedChangesGuard] beforeunload useEffect triggered with when=', when);
		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (!when) return;
			console.log('[UnsavedChangesGuard] beforeunload fired');
			e.preventDefault();
			e.returnValue = '';
		};
		if (when) {
			console.log('[UnsavedChangesGuard] registering beforeunload');
			window.addEventListener('beforeunload', handleBeforeUnload);
		}
		return () => {
			console.log('[UnsavedChangesGuard] removing beforeunload listener');
			window.removeEventListener('beforeunload', handleBeforeUnload);
		};
	}, [when]);

	const handleStay = () => {
		console.log('[UnsavedChangesGuard] user chose: Stay');
		setOpen(false);
		pendingHashRef.current = null;
	};

	const handleLeave = () => {
		console.log('[UnsavedChangesGuard] user chose: Leave -> proceeding to', pendingHashRef.current);
		const target = pendingHashRef.current;
		setOpen(false);
		if (target) {
			allowNextRef.current = true;
			pendingHashRef.current = null;
			if (window.location.hash !== target) {
				window.location.hash = target;
			}
		}
	};

	const handleSaveAndLeave = async () => {
		console.log('[UnsavedChangesGuard] user chose: Save and leave');
		if (!onSave) { handleLeave(); return; }
		try {
			setSaving(true);
			await onSave();
			handleLeave();
		} catch (err) {
			console.log('[UnsavedChangesGuard] save failed, staying on page', err);
			setSaving(false);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onClose={handleStay} maxWidth="xs" fullWidth>
			<DialogTitle>Unsaved Changes</DialogTitle>
			<DialogContent>
				<Typography variant="body2">
					You have unsaved changes. Would you like to save before leaving this page?
				</Typography>
			</DialogContent>
			<DialogActions>
				<Button onClick={handleStay}>Cancel</Button>
				<Button onClick={handleLeave} color="warning">Leave without saving</Button>
				<Button onClick={handleSaveAndLeave} variant="contained" disabled={saving}>
					{saving ? 'Saving…' : 'Save and leave'}
				</Button>
			</DialogActions>
		</Dialog>
	);
};

export default UnsavedChangesGuard;


