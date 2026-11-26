#!/usr/bin/env python3
"""Render a module-coverage heatmap and module prevalence chart from profile results JSON."""
import json
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap, BoundaryNorm
from matplotlib.patches import Patch

MODULES = [
    ('core_hr_records', 'Core HR records'), ('org_chart', 'Org chart'),
    ('employee_self_service', 'Self-service'), ('documents_esign', 'Documents + e-sign'),
    ('onboarding_offboarding', 'On/offboarding'), ('recruiting_ats', 'Recruiting (ATS)'),
    ('domestic_payroll', 'Domestic payroll'), ('multi_country_payroll', 'Multi-country payroll'),
    ('eor_contractors', 'EOR + contractors'), ('statutory_filing', 'Statutory filing'),
    ('time_attendance', 'Time + attendance'), ('leave_absence', 'Leave'),
    ('shift_scheduling', 'Shift scheduling'), ('timesheets_projects', 'Timesheets / PSA'),
    ('performance_reviews', 'Performance reviews'), ('goals_okrs', 'Goals / OKRs'),
    ('feedback_1on1s', 'Feedback + 1:1s'), ('compensation_planning', 'Comp planning'),
    ('learning_lms', 'Learning (LMS)'), ('engagement_surveys', 'Engagement surveys'),
    ('benefits_admin', 'Benefits admin'), ('expenses_spend', 'Expenses / spend'),
    ('helpdesk_cases', 'HR helpdesk'), ('workforce_planning', 'Workforce planning'),
    ('analytics_bi', 'Analytics + reports'), ('ai_assistant', 'AI assistant'),
    ('ai_agents', 'AI agents'), ('public_api_webhooks', 'Public API + webhooks'),
    ('mcp_server', 'MCP server'), ('integration_marketplace', 'Integration marketplace'),
    ('mobile_app', 'Mobile app'), ('it_device_management', 'IT device mgmt'),
    ('earned_wage_access', 'Earned wage access'), ('no_code_workflows', 'No-code workflows'),
]
SCORE = {'native': 4, 'add_on_or_partial': 3, 'via_partner': 2, 'absent': 1, 'unknown': 0}


def main(results_path, heatmap_out, prevalence_out):
    data = json.load(open(results_path))
    names = [d['name'] for d in data]
    mat = [[SCORE.get(d['module_coverage'].get(k, 'unknown'), 0) for k, _ in MODULES] for d in data]

    cmap = ListedColormap(['#FFFFFF', '#E6E8EC', '#F5D76E', '#9CD3A8', '#1E7B4A'])
    norm = BoundaryNorm([-0.5, 0.5, 1.5, 2.5, 3.5, 4.5], cmap.N)
    fig, ax = plt.subplots(figsize=(17, 0.42 * len(names) + 3.2), dpi=170)
    ax.imshow(mat, cmap=cmap, norm=norm, aspect='auto')
    ax.set_xticks(range(len(MODULES)))
    ax.set_xticklabels([m[1] for m in MODULES], rotation=60, ha='right', fontsize=9)
    ax.set_yticks(range(len(names)))
    ax.set_yticklabels(names, fontsize=9.5)
    ax.set_xticks([x - 0.5 for x in range(1, len(MODULES))], minor=True)
    ax.set_yticks([y - 0.5 for y in range(1, len(names))], minor=True)
    ax.grid(which='minor', color='white', linewidth=1.2)
    ax.tick_params(which='minor', length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)
    legend = [Patch(color='#1E7B4A', label='Native'), Patch(color='#9CD3A8', label='Add-on or partial'),
              Patch(color='#F5D76E', label='Via partner'), Patch(color='#E6E8EC', label='Absent'),
              Patch(facecolor='#FFFFFF', edgecolor='#999999', label='Unknown')]
    ax.legend(handles=legend, loc='upper center', bbox_to_anchor=(0.5, 1.0 + 1.6 / (0.42 * len(names) + 3.2)),
              ncol=5, frameon=False, fontsize=10)
    ax.set_title('Module coverage across Keka and 30 alternatives (researched November 2026)',
                 fontsize=13, pad=42, loc='left')
    fig.tight_layout()
    fig.savefig(heatmap_out, bbox_inches='tight')
    plt.close(fig)

    native = [sum(1 for row in mat if row[j] == 4) for j in range(len(MODULES))]
    partial = [sum(1 for row in mat if row[j] in (2, 3)) for j in range(len(MODULES))]
    order = sorted(range(len(MODULES)), key=lambda j: (native[j], partial[j]))
    fig, ax = plt.subplots(figsize=(10, 10), dpi=170)
    labels = [MODULES[j][1] for j in order]
    ax.barh(labels, [native[j] for j in order], color='#1E7B4A', label='Native')
    ax.barh(labels, [partial[j] for j in order], left=[native[j] for j in order], color='#F5D76E',
            label='Add-on, partial or via partner')
    ax.set_xlabel(f'Number of platforms (out of {len(names)})')
    ax.set_title('How common each capability is across the 31 platforms', loc='left', fontsize=12)
    ax.legend(frameon=False, loc='lower right')
    ax.spines[['top', 'right']].set_visible(False)
    ax.set_xlim(0, len(names))
    fig.tight_layout()
    fig.savefig(prevalence_out, bbox_inches='tight')
    plt.close(fig)
    for j in order:
        print(f'{MODULES[j][1]:28s} native={native[j]:2d} partial/partner={partial[j]:2d}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
