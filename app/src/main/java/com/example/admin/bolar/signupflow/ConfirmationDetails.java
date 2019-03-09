package com.example.admin.bolar.signupflow;

import android.content.Intent;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;

import com.example.admin.bolar.R;
import com.example.admin.bolar.companyMain.CompanyHome;
import com.example.admin.bolar.individuallandlordmain.IndividualHome;
import com.example.admin.bolar.tenantmain.TenantHome;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;

public class ConfirmationDetails extends AppCompatActivity {

    private String first;
    private String last;
    private String type;
    public FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
    public TextView fname;
    public TextView lname;
    public TextView email;
    public TextView phone;
    public Button next;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_confirmation_details);

        Intent intent = getIntent();
        first = intent.getStringExtra("firstName");
        last = intent.getStringExtra("lastName");
        type = intent.getStringExtra("type");

        fname = findViewById(R.id.fnameConfirm);
        lname = findViewById(R.id.lnameConfirm);
        email = findViewById(R.id.emailConfirm);
        phone = findViewById(R.id.phoneNumConfirm);
        next = findViewById(R.id.confirm);

        nextOnClick();

        fname.setText(first);
        lname.setText(last);
        email.setText(user.getEmail());
        phone.setText(user.getPhoneNumber());
    }

    public void nextOnClick(){
        next.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if(type.equals("Tenant")){
                    Intent intent = new Intent(ConfirmationDetails.this , TenantHome.class);
                    intent.putExtra("type", type);
                    ConfirmationDetails.this.startActivity(intent);
                }else if(type.equals(("IndividualLandlord"))){
                    Intent intent = new Intent(ConfirmationDetails.this , IndividualHome.class);
                    intent.putExtra("type", type);
                    ConfirmationDetails.this.startActivity(intent);
                }else if(type.equals(("Company"))){
                    Intent intent = new Intent(ConfirmationDetails.this , CompanyHome.class);
                    intent.putExtra("type", type);
                    ConfirmationDetails.this.startActivity(intent);
                }

            }
        });
    }
}
