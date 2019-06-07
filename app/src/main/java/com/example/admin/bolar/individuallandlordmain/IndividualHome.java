package com.example.admin.bolar.individuallandlordmain;

import androidx.appcompat.app.AppCompatActivity;
import androidx.cardview.widget.CardView;

import android.content.Intent;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.widget.GridLayout;
import android.widget.Toast;

import com.example.admin.bolar.R;
import com.example.admin.bolar.companyMain.CompanyHome;
import com.example.admin.bolar.tenantmain.TenantHome;

public class IndividualHome extends AppCompatActivity {


    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_individual_home);

    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        MenuInflater inflator = getMenuInflater();
        inflator.inflate(R.menu.tenant_menu, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {

        switch(item.getItemId()){
            case R.id.tenant_application:
                Toast.makeText(this, "New Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_new_application:
                Toast.makeText(this, "New Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_pending_applications:
                Toast.makeText(this, "New Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_settings:
                Toast.makeText(this, "New Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_account_settings:
                Toast.makeText(this, "New Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_bank_settings:
                Toast.makeText(this, "New Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_customer_support:
                Toast.makeText(this, "New Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_log_out:
                Toast.makeText(this, "New Application Selected", Toast.LENGTH_SHORT).show();
            case R.id.tenant_score_history:
                Toast.makeText(this, "New Application Selected", Toast.LENGTH_SHORT).show();
            default:
                return super.onOptionsItemSelected(item);
        }
    }

}
