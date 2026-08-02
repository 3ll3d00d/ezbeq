import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import MultiSelect from './MultiSelect';

const openDropdown = (container) => fireEvent.mouseDown(container.querySelector('input'));

describe('MultiSelect', () => {
    it('shows the label and placeholder', () => {
        render(<MultiSelect items={['a']} label="My Label" placeholder="ph"/>);
        expect(screen.getByText('My Label')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('ph')).toBeInTheDocument();
    });

    it('renders each selected value as a removable chip', () => {
        render(<MultiSelect items={['a', 'b', 'c']} selectedValues={['a', 'b']} label="L"/>);
        expect(screen.getByText('a')).toBeInTheDocument();
        expect(screen.getByText('b')).toBeInTheDocument();
        expect(screen.queryByText('c')).not.toBeInTheDocument();
    });

    it('lists every item as an option, checking the ones already selected', () => {
        const {container} = render(<MultiSelect items={['a', 'b', 'c']} selectedValues={['a']} label="L"/>);
        openDropdown(container);

        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(3);
        expect(options[0]).toHaveAttribute('aria-selected', 'true'); // a
        expect(options[1]).toHaveAttribute('aria-selected', 'false'); // b
    });

    it('calls onToggleOption with the full new selection when an unselected option is clicked', () => {
        const onToggleOption = vi.fn();
        const {container} = render(
            <MultiSelect items={['a', 'b']} selectedValues={['a']} label="L" onToggleOption={onToggleOption}/>
        );
        openDropdown(container);

        fireEvent.click(screen.getByRole('option', {name: 'b'}));

        expect(onToggleOption).toHaveBeenCalledWith(['a', 'b']);
    });

    it('calls onToggleOption with the option removed when an already-selected option is clicked', () => {
        const onToggleOption = vi.fn();
        const {container} = render(
            <MultiSelect items={['a', 'b']} selectedValues={['a', 'b']} label="L" onToggleOption={onToggleOption}/>
        );
        openDropdown(container);

        fireEvent.click(screen.getByRole('option', {name: 'a'}));

        expect(onToggleOption).toHaveBeenCalledWith(['b']);
    });

    it('calls onToggleOption when a chip is removed directly', () => {
        const onToggleOption = vi.fn();
        const {container} = render(
            <MultiSelect items={['a', 'b']} selectedValues={['a', 'b']} label="L" onToggleOption={onToggleOption}/>
        );

        // each chip has its own delete icon, so scope the query to the "a" chip specifically
        const chipA = screen.getByText('a').closest('[role="button"]');
        fireEvent.click(chipA.querySelector('[data-testid="CancelIcon"]'));

        expect(onToggleOption).toHaveBeenCalledWith(['b']);
    });

    it('calls onClearOptions when the clear icon is clicked', () => {
        const onClearOptions = vi.fn();
        const {container} = render(
            <MultiSelect items={['a', 'b']} selectedValues={['a']} label="L"
                         onToggleOption={vi.fn()} onClearOptions={onClearOptions}/>
        );

        fireEvent.click(container.querySelector('button[aria-label="Clear"]'));

        expect(onClearOptions).toHaveBeenCalled();
    });

    it('renders a custom getOptionLabel for both chips and options', () => {
        const items = [{id: 1, name: 'Alpha'}, {id: 2, name: 'Beta'}];
        const {container} = render(
            <MultiSelect items={items} selectedValues={[items[0]]} label="L" getOptionLabel={o => o.name}/>
        );
        expect(screen.getByText('Alpha')).toBeInTheDocument();

        openDropdown(container);
        expect(screen.getByRole('option', {name: 'Beta'})).toBeInTheDocument();
    });

    it('strikes through options that isInView reports as out of view', () => {
        const {container} = render(
            <MultiSelect items={['a', 'b']} label="L" isInView={v => v !== 'b'}/>
        );
        openDropdown(container);

        const optionB = screen.getByRole('option', {name: 'b'}).querySelector('div');
        expect(optionB).toHaveStyle({textDecoration: 'line-through'});
    });
});
