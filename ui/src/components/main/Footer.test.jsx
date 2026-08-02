import {beforeEach, describe, expect, it, vi} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import Footer from './Footer';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {getVersion: vi.fn()}
}));

beforeEach(() => {
    ezbeq.getVersion.mockReset();
});

const renderFooter = async (meta, version) => {
    ezbeq.getVersion.mockResolvedValue(version);
    const result = render(<Footer meta={meta}/>);
    await waitFor(() => expect(ezbeq.getVersion).toHaveBeenCalled());
    return result;
};

describe('Footer', () => {
    it('formats the catalogue timestamp and short sha', async () => {
        // 2020-01-02T03:04:05Z
        await renderFooter({loaded: 1577934245, version: 'abcdef1234567'}, {});
        expect(await screen.findByText(/cat: 20200102_030405 \/ abcdef1/)).toBeInTheDocument();
    });

    it('shows "?" for the catalogue timestamp when meta has no loaded time', async () => {
        await renderFooter({version: 'abcdef1234567'}, {});
        expect(await screen.findByText(/cat: \? \/ abcdef1/)).toBeInTheDocument();
    });

    it('shows nothing for the catalogue field when there is no meta at all', async () => {
        await renderFooter(null, {});
        expect(screen.queryByText(/cat:/)).not.toBeInTheDocument();
    });

    it('shows the app version when known', async () => {
        await renderFooter(null, {version: '1.2.3'});
        expect(await screen.findByText(/app: v1\.2\.3/)).toBeInTheDocument();
    });

    it('falls back to the git ref when the version is UNKNOWN', async () => {
        await renderFooter(null, {version: 'UNKNOWN', branch: 'main', sha: 'abc1234'});
        expect(await screen.findByText(/git: main@abc1234/)).toBeInTheDocument();
        expect(screen.queryByText(/vUNKNOWN/)).not.toBeInTheDocument();
    });

    it('combines version and git ref when both are known', async () => {
        await renderFooter(null, {version: '1.2.3', branch: 'main', sha: 'abc1234'});
        const appText = await screen.findByText(/app:/);
        expect(appText).toHaveTextContent('app: v1.2.3 git: main@abc1234');
    });

    it('shows nothing for the app field when neither version nor git info is available', async () => {
        await renderFooter(null, {});
        expect(screen.queryByText(/app:/)).not.toBeInTheDocument();
    });

    it('does not blow up when the version fetch fails', async () => {
        ezbeq.getVersion.mockRejectedValue(new Error('offline'));
        render(<Footer meta={null}/>);

        await waitFor(() => expect(ezbeq.getVersion).toHaveBeenCalled());
        // still renders its border/container without throwing
        expect(screen.queryByText(/app:/)).not.toBeInTheDocument();
    });
});
